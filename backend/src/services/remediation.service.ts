import { Op, QueryTypes } from 'sequelize';
import sequelize from '../config/database';
import { getTenantStore } from '../middlewares/tenant';
import {
  Department,
  EvidenceFile,
  EvidenceScanStatus,
  EvidenceStatus,
  EvidenceType,
  NotificationType,
  OperationType,
  RemediationAction,
  RemediationActionStatus,
  RiskActionLink,
  RiskLifecycleStatus,
  RiskRecord,
  TenantMember,
  TenantMemberStatus,
  VerificationStatus,
} from '../models';
import { AppError } from '../utils/http';
import { pagination, parsePagination } from '../utils/pagination';
import auditLogService from './audit-log.service';
import { validateEvidence } from './evidence-security.service';
import { fileStorage } from './file-storage.service';
import notificationService from './notification.service';
import objectAccessService from './object-access.service';
import { verificationDuration } from './metrics.service';
import { assertLockVersion } from '../utils/optimistic-lock';
import idempotencyService from './idempotency.service';

type RequestUser = NonNullable<Express.Request['user']>;

interface RiskLinkInput {
  riskId: string;
  isRequired?: boolean;
  contributionDescription: string;
}

interface CreateActionInput {
  title: string;
  description: string;
  ownerUserId: string;
  ownerDepartmentId: string;
  startDate?: Date | null;
  dueDate: Date;
  riskLinks: RiskLinkInput[];
}

class RemediationService {
  private schema(): string {
    const schema = getTenantStore()?.schema;
    if (!schema || schema === 'public' || !/^tenant_[a-z0-9_]+$/i.test(schema)) {
      throw new AppError(500, 'INTERNAL_ERROR', '租户上下文无效');
    }
    return schema;
  }

  private async nextCode(transaction: any): Promise<string> {
    const schema = this.schema().replace(/"/g, '""');
    const [row] = await sequelize.query<{ sequence: string }>(
      `SELECT nextval('"${schema}"."remediation_action_code_seq"')::text AS sequence`,
      { type: QueryTypes.SELECT, transaction },
    );
    const date = new Date();
    const period = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
    return `ACT-${period}-${String(row.sequence).padStart(6, '0')}`;
  }

  private async validateInput(input: CreateActionInput, user: RequestUser, transaction?: any) {
    if (!input.title?.trim() || !input.description?.trim() || !input.dueDate) {
      throw new AppError(400, 'VALIDATION_ERROR', '整改行动标题、描述和期限必填');
    }
    if (!Array.isArray(input.riskLinks) || !input.riskLinks.length) {
      throw new AppError(400, 'VALIDATION_ERROR', '整改行动至少关联一个风险');
    }
    const riskIds = [...new Set(input.riskLinks.map((link) => link.riskId))];
    if (riskIds.length !== input.riskLinks.length) throw new AppError(409, 'CONFLICT', '不能重复关联同一风险');
    const department = await Department.findOne({
      where: { id: input.ownerDepartmentId, status: 'active' },
      transaction,
    });
    const member = await TenantMember.findOne({
      where: { userId: input.ownerUserId, status: TenantMemberStatus.ACTIVE },
      transaction,
    });
    const risks = await RiskRecord.findAll({
      where: {
        id: { [Op.in]: riskIds },
        status: { [Op.notIn]: [RiskLifecycleStatus.CLOSED, RiskLifecycleStatus.CANCELLED] },
      },
      transaction,
      ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}),
    });
    if (!department || !member) throw new AppError(404, 'NOT_FOUND', '整改责任部门或负责人不存在');
    if (risks.length !== riskIds.length) throw new AppError(404, 'NOT_FOUND', '关联风险不存在或已关闭');
    for (const risk of risks) await objectAccessService.riskOrNotFound(risk.id, user, 'update');
    if (input.riskLinks.some((link) => !link.contributionDescription?.trim())) {
      throw new AppError(400, 'VALIDATION_ERROR', '请说明行动对每个风险的整改贡献');
    }
    return risks;
  }

  async list(query: Record<string, unknown>, user: RequestUser) {
    const { page, pageSize } = parsePagination(query as any);
    const where: any = await objectAccessService.remediationScope(user);
    if (query.status) where.status = query.status;
    if (query.ownerUserId) where.ownerUserId = query.ownerUserId;
    if (query.ownerDepartmentId) where.ownerDepartmentId = query.ownerDepartmentId;
    if (query.overdue === 'true') {
      where.dueDate = { [Op.lt]: new Date() };
      where.status = { [Op.notIn]: [RemediationActionStatus.COMPLETED, RemediationActionStatus.CANCELLED] };
    }
    const { rows, count } = await RemediationAction.findAndCountAll({
      where,
      order: [['dueDate', 'ASC'], ['createdAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const ids = rows.map((row) => row.id);
    const links = ids.length
      ? await RiskActionLink.findAll({ where: { actionId: { [Op.in]: ids } }, include: [{ association: 'risk' }] })
      : [];
    const visibleRiskIds = await objectAccessService.accessibleRiskIds(user);
    return {
      items: rows.map((row) => ({
        ...row.toJSON(),
        riskLinks: links.filter((link) =>
          link.actionId === row.id
          && (visibleRiskIds === null || visibleRiskIds.includes(link.riskId))),
      })),
      pagination: pagination(page, pageSize, count),
    };
  }

  async detail(id: string, user: RequestUser) {
    const action = await objectAccessService.remediationOrNotFound(id, user);
    const [riskLinks, evidenceFiles] = await Promise.all([
      RiskActionLink.findAll({ where: { actionId: id }, include: [{ association: 'risk' }] }),
      EvidenceFile.findAll({ where: { remediationActionId: id, status: 'active' } }),
    ]);
    const visibleRiskIds = await objectAccessService.accessibleRiskIds(user);
    return {
      ...action.toJSON(),
      riskLinks: riskLinks.filter((link) =>
        visibleRiskIds === null || visibleRiskIds.includes(link.riskId)),
      evidenceFiles: evidenceFiles.map(({ dataValues }: any) => {
        const { storageKey: _key, filePath: _path, storedFilename: _stored, ...safe } = dataValues;
        return safe;
      }),
    };
  }

  async create(input: CreateActionInput, user: RequestUser) {
    const action = await sequelize.transaction(async (transaction) => {
      const risks = await this.validateInput(input, user, transaction);
      const created = await RemediationAction.create({
        code: await this.nextCode(transaction),
        title: input.title.trim(),
        description: input.description.trim(),
        ownerUserId: input.ownerUserId,
        ownerDepartmentId: input.ownerDepartmentId,
        startDate: input.startDate || null,
        dueDate: input.dueDate,
        status: RemediationActionStatus.NOT_STARTED,
        createdBy: user.userId,
      }, { transaction });
      await RiskActionLink.bulkCreate(input.riskLinks.map((link) => ({
        riskId: link.riskId,
        actionId: created.id,
        isRequired: link.isRequired !== false,
        contributionDescription: link.contributionDescription.trim(),
        verificationStatus: VerificationStatus.PENDING,
      })), { transaction });
      await RiskRecord.update(
        { status: RiskLifecycleStatus.REMEDIATING },
        { where: { id: { [Op.in]: risks.map((risk) => risk.id) }, status: RiskLifecycleStatus.OPEN }, transaction },
      );
      return created;
    });
    const firstLink = input.riskLinks[0];
    const firstRisk = await RiskRecord.findByPk(firstLink.riskId);
    await notificationService.create({
      userId: input.ownerUserId,
      taskId: firstRisk!.taskId,
      type: NotificationType.REMEDIATION_ASSIGNED,
      title: '新的整改行动已分配',
      content: `${action.code} ${action.title}`,
    });
    await auditLogService.log({
      userId: user.userId,
      operationType: OperationType.CREATE,
      resourceType: 'remediation_action',
      resourceId: action.id,
      operationDetails: `创建整改行动 ${action.code}，关联 ${input.riskLinks.length} 个风险`,
      success: true,
      departmentId: action.ownerDepartmentId,
    });
    return this.detail(action.id, user);
  }

  async update(
    id: string,
    input: Partial<CreateActionInput> & { progressNote?: string },
    user: RequestUser,
    expectedLockVersion: number,
  ) {
    await objectAccessService.remediationOrNotFound(id, user, 'update');
    await sequelize.transaction(async (transaction) => {
      const action = await RemediationAction.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!action) throw new AppError(404, 'NOT_FOUND', '整改行动不存在');
      assertLockVersion(action.lockVersion, expectedLockVersion);
      if ([RemediationActionStatus.PENDING_VERIFICATION, RemediationActionStatus.COMPLETED, RemediationActionStatus.CANCELLED].includes(action.status)) {
        throw new AppError(409, 'CONFLICT', '当前状态不能修改整改行动');
      }
      if (input.ownerDepartmentId || input.ownerUserId) {
        const departmentId = input.ownerDepartmentId || action.ownerDepartmentId;
        const ownerUserId = input.ownerUserId || action.ownerUserId;
        const [department, member] = await Promise.all([
          Department.findOne({ where: { id: departmentId, status: 'active' }, transaction }),
          TenantMember.findOne({
            where: { userId: ownerUserId, status: TenantMemberStatus.ACTIVE },
            transaction,
          }),
        ]);
        if (!department || !member) throw new AppError(404, 'NOT_FOUND', '整改责任部门或负责人不存在');
      }
      await action.update({
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
        ...(input.ownerDepartmentId !== undefined ? { ownerDepartmentId: input.ownerDepartmentId } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.progressNote !== undefined ? { progressNote: input.progressNote.trim() } : {}),
        status: RemediationActionStatus.IN_PROGRESS,
        lockVersion: action.lockVersion + 1,
      }, { transaction });
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'remediation_action',
        resourceId: action.id,
        operationDetails: `更新整改行动 ${action.code}`,
        success: true,
        departmentId: action.ownerDepartmentId,
      }, transaction);
    });
    return this.detail(id, user);
  }

  async replaceRisks(
    id: string,
    riskLinks: RiskLinkInput[],
    user: RequestUser,
    expectedLockVersion: number,
  ) {
    const action = await objectAccessService.remediationOrNotFound(id, user, 'update');
    const input: CreateActionInput = {
      title: action.title,
      description: action.description,
      ownerUserId: action.ownerUserId,
      ownerDepartmentId: action.ownerDepartmentId,
      dueDate: action.dueDate,
      riskLinks,
    };
    await sequelize.transaction(async (transaction) => {
      const locked = await RemediationAction.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!locked) throw new AppError(404, 'NOT_FOUND', '整改行动不存在');
      assertLockVersion(locked.lockVersion, expectedLockVersion);
      if ([RemediationActionStatus.PENDING_VERIFICATION, RemediationActionStatus.COMPLETED, RemediationActionStatus.CANCELLED].includes(locked.status)) {
        throw new AppError(409, 'CONFLICT', '当前状态不能修改风险关联');
      }
      await this.validateInput(input, user, transaction);
      const before = await RiskActionLink.findAll({
        where: { actionId: id },
        attributes: ['riskId'],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      await RiskActionLink.destroy({ where: { actionId: id }, transaction });
      await RiskActionLink.bulkCreate(riskLinks.map((link) => ({
        riskId: link.riskId,
        actionId: id,
        isRequired: link.isRequired !== false,
        contributionDescription: link.contributionDescription.trim(),
        verificationStatus: VerificationStatus.PENDING,
      })), { transaction });
      await locked.update({ lockVersion: locked.lockVersion + 1 }, { transaction });
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'remediation_action',
        resourceId: id,
        operationDetails: `更新风险关联：${before.map((link) => link.riskId).join(',')} -> ${riskLinks.map((link) => link.riskId).join(',')}`,
        success: true,
        departmentId: locked.ownerDepartmentId,
      }, transaction);
    });
    return this.detail(id, user);
  }

  async uploadEvidence(id: string, file: Express.Multer.File, tenantId: string, user: RequestUser) {
    const action = await objectAccessService.remediationOrNotFound(id, user, 'update');
    if (action.ownerUserId !== user.userId && !user.isGlobalAdmin
      && user.permissionScopes?.remediation_actions?.update !== 'all') {
      throw new AppError(404, 'NOT_FOUND', '整改行动不存在');
    }
    const validated = validateEvidence(file, tenantId);
    await fileStorage.put(validated.storageKey, file.buffer);
    try {
      const version = Number(await EvidenceFile.max('version', {
        where: { remediationActionId: id, evidenceType: EvidenceType.REMEDIATION },
      }) || 0) + 1;
      const evidence = await EvidenceFile.create({
        questionItemId: null,
        remediationActionId: id,
        originalFilename: validated.originalFilename,
        storedFilename: null,
        filePath: null,
        storageKey: validated.storageKey,
        sha256: validated.sha256,
        status: EvidenceStatus.ACTIVE,
        scanStatus: EvidenceScanStatus.CLEAN,
        version,
        isLocked: false,
        deletedAt: null,
        evidenceType: EvidenceType.REMEDIATION,
        evidencePurpose: 'remediation',
        fileSize: file.size,
        mimeType: file.mimetype,
        uploadedBy: user.userId,
      });
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.CREATE,
        resourceType: 'evidence',
        resourceId: evidence.id,
        operationDetails: `上传整改行动 ${action.code} 的证据`,
        success: true,
        departmentId: action.ownerDepartmentId,
      });
      const { storageKey: _key, filePath: _path, storedFilename: _stored, ...safe } = evidence.toJSON();
      return safe;
    } catch (error) {
      await fileStorage.delete(validated.storageKey);
      throw error;
    }
  }

  async deleteEvidence(id: string, evidenceId: string, user: RequestUser) {
    const action = await objectAccessService.remediationOrNotFound(id, user, 'update');
    const evidence = await EvidenceFile.findOne({
      where: { id: evidenceId, remediationActionId: id, status: 'active' },
    });
    if (!evidence) throw new AppError(404, 'NOT_FOUND', '证据不存在');
    if (evidence.isLocked) throw new AppError(409, 'EVIDENCE_LOCKED', '证据已锁定，不能删除');
    await sequelize.transaction(async (transaction) => {
      await evidence.update({
        status: EvidenceStatus.DELETED,
        deletedAt: new Date(),
        deletedBy: user.userId,
      }, { transaction });
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.DELETE,
        resourceType: 'evidence',
        resourceId: evidence.id,
        operationDetails: `软删除整改行动 ${action.code} 的证据，物理文件保留用于审计追溯`,
        success: true,
        departmentId: action.ownerDepartmentId,
      }, transaction);
    });
  }

  async submit(
    id: string,
    user: RequestUser,
    expectedLockVersion: number,
    rawIdempotencyKey?: string,
  ) {
    const visible = await objectAccessService.remediationOrNotFound(id, user, 'submit');
    if (visible.ownerUserId !== user.userId && !user.isGlobalAdmin) {
      throw new AppError(404, 'NOT_FOUND', '整改行动不存在');
    }
    const idempotencyKey = idempotencyService.requireKey(rawIdempotencyKey);
    const result = await idempotencyService.execute(
      'remediation.submit',
      idempotencyKey,
      user.userId,
      { id, expectedLockVersion },
      async (transaction) => {
      const locked = await RemediationAction.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!locked) throw new AppError(404, 'NOT_FOUND', '整改行动不存在');
      assertLockVersion(locked.lockVersion, expectedLockVersion);
      if (![RemediationActionStatus.NOT_STARTED, RemediationActionStatus.IN_PROGRESS].includes(locked.status)) {
        throw new AppError(409, 'CONFLICT', '当前状态不能提交复核');
      }
      if (!locked.progressNote?.trim()) {
        throw new AppError(400, 'VALIDATION_ERROR', '提交整改行动前请填写进展说明');
      }
      const evidenceCount = await EvidenceFile.count({
        where: { remediationActionId: id, status: 'active' },
        transaction,
      });
      if (!evidenceCount) throw new AppError(400, 'VALIDATION_ERROR', '提交整改行动前至少上传一份证据');
      const links = await RiskActionLink.findAll({
        where: { actionId: id },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      await Promise.all(links.map((link) => link.update({
        verificationStatus: VerificationStatus.PENDING,
        verifiedBy: null,
        verifiedAt: null,
        reviewComment: null,
        selfReview: false,
      }, { transaction })));
      await locked.update({
        status: RemediationActionStatus.PENDING_VERIFICATION,
        submittedAt: new Date(),
        completedAt: null,
        lockVersion: locked.lockVersion + 1,
      }, { transaction });
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'remediation_action',
        resourceId: locked.id,
        operationDetails: `提交整改行动 ${locked.code} 复核并重置 ${links.length} 个关联结论`,
        success: true,
        departmentId: locked.ownerDepartmentId,
      }, transaction);
        return { resourceId: locked.id };
      },
    );
    const action = await RemediationAction.findByPk(result.value.resourceId);
    if (!action) throw new AppError(500, 'INTERNAL_ERROR', '整改提交结果不存在');
    if (!result.replayed) {
      const firstLink = await RiskActionLink.findOne({ where: { actionId: id } });
      const firstRisk = firstLink ? await RiskRecord.findByPk(firstLink.riskId) : null;
      if (firstRisk) {
        await notificationService.create({
          userId: firstRisk.ownerUserId,
          taskId: firstRisk.taskId,
          type: NotificationType.REMEDIATION_SUBMITTED,
          title: '整改行动待复核',
          content: `${action.code} ${action.title}`,
        });
      }
    }
    return this.detail(id, user);
  }

  async verify(
    riskId: string,
    actionId: string,
    input: { decision: VerificationStatus; comment?: string },
    user: RequestUser,
    expectedLockVersion: number,
  ) {
    if (![VerificationStatus.APPROVED, VerificationStatus.REJECTED].includes(input.decision)) {
      throw new AppError(400, 'VALIDATION_ERROR', '复核结论必须为通过或驳回');
    }
    if (input.decision === VerificationStatus.REJECTED && !input.comment?.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', '驳回时必须填写原因');
    }
    await objectAccessService.riskActionLinkOrNotFound(riskId, actionId, user, 'verify');
    const action = await sequelize.transaction(async (transaction) => {
      const lockedAction = await RemediationAction.findByPk(actionId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const link = await RiskActionLink.findOne({
        where: { riskId, actionId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const risk = await RiskRecord.findByPk(riskId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!lockedAction || !link || !risk) {
        throw new AppError(404, 'NOT_FOUND', '风险整改关联不存在');
      }
      assertLockVersion(lockedAction.lockVersion, expectedLockVersion);
      if (lockedAction.status !== RemediationActionStatus.PENDING_VERIFICATION) {
        throw new AppError(409, 'CONFLICT', '整改行动尚未提交复核');
      }
      await link.update({
        verificationStatus: input.decision,
        verifiedBy: user.userId,
        verifiedAt: new Date(),
        reviewComment: input.comment?.trim() || null,
        selfReview: lockedAction.ownerUserId === user.userId,
      }, { transaction });
      if (input.decision === VerificationStatus.REJECTED) {
        await lockedAction.update({
          status: RemediationActionStatus.IN_PROGRESS,
          completedAt: null,
          lockVersion: lockedAction.lockVersion + 1,
        }, { transaction });
        await risk.update({
          status: RiskLifecycleStatus.REMEDIATING,
          lockVersion: risk.lockVersion + 1,
        }, { transaction });
      } else {
        const pending = await RiskActionLink.count({
          where: {
            actionId,
            isRequired: true,
            verificationStatus: { [Op.ne]: VerificationStatus.APPROVED },
          },
          transaction,
        });
        if (!pending) {
          await lockedAction.update({
            status: RemediationActionStatus.COMPLETED,
            completedAt: new Date(),
            lockVersion: lockedAction.lockVersion + 1,
          }, { transaction });
        } else {
          await lockedAction.update({
            lockVersion: lockedAction.lockVersion + 1,
          }, { transaction });
        }
        const riskPending = await RiskActionLink.count({
          where: {
            riskId,
            isRequired: true,
            verificationStatus: { [Op.ne]: VerificationStatus.APPROVED },
          },
          transaction,
        });
        if (!riskPending) {
          await risk.update({
            status: RiskLifecycleStatus.PENDING_VERIFICATION,
            lockVersion: risk.lockVersion + 1,
          }, { transaction });
        }
      }
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'risk_action_link',
        resourceId: link.id,
        operationDetails: `逐风险复核 ${input.decision}，自审=${lockedAction.ownerUserId === user.userId}`,
        success: true,
        departmentId: lockedAction.ownerDepartmentId,
      }, transaction);
      return lockedAction;
    });
    if (action.submittedAt) {
      verificationDuration.observe(Math.max(0, (Date.now() - action.submittedAt.getTime()) / 1000));
    }
    const risk = await RiskRecord.findByPk(riskId);
    if (risk) {
      await notificationService.create({
        userId: action.ownerUserId,
        taskId: risk.taskId,
        type: input.decision === VerificationStatus.REJECTED
          ? NotificationType.REMEDIATION_REJECTED
          : NotificationType.REMEDIATION_APPROVED,
        title: input.decision === VerificationStatus.REJECTED ? '整改行动被驳回' : '整改行动复核通过',
        content: `${action.code} ${input.comment?.trim() || ''}`.trim(),
      });
    }
    return this.detail(actionId, user);
  }
}

export default new RemediationService();
