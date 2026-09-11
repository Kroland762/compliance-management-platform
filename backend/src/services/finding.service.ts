import { Op, QueryTypes, type Transaction } from 'sequelize';
import sequelize from '../config/database';
import { getTenantStore } from '../middlewares/tenant';
import {
  Department,
  AssessmentAsset,
  Finding,
  FindingActionLink,
  FindingDisposition,
  FindingStatus,
  OperationType,
  QuestionItem,
  RemediationAction,
  RemediationActionStatus,
  RiskActionLink,
  RiskFindingLink,
  RiskLifecycleStatus,
  RiskLevel,
  RiskRecord,
  TenantMember,
  TenantMemberStatus,
  VerificationStatus,
} from '../models';
import { AppError } from '../utils/http';
import { assertLockVersion } from '../utils/optimistic-lock';
import { pagination, parsePagination } from '../utils/pagination';
import auditLogService from './audit-log.service';
import notificationService from './notification.service';
import objectAccessService from './object-access.service';
import idempotencyService from './idempotency.service';
import lookupService from './lookup.service';

type RequestUser = NonNullable<Express.Request['user']>;

export interface FindingReviewInput {
  title?: string;
  description?: string;
  severity?: RiskLevel;
  ownerDepartmentId?: string;
  ownerUserId?: string;
  dueDate?: Date | null;
}

class FindingService {
  private schema(): string {
    const schema = getTenantStore()?.schema;
    if (!schema || schema === 'public' || !/^tenant_[a-z0-9_]+$/i.test(schema)) {
      throw new AppError(500, 'INTERNAL_ERROR', '租户上下文无效');
    }
    return schema;
  }

  private async nextCode(transaction: Transaction): Promise<string> {
    const schema = this.schema().replace(/"/g, '""');
    const [row] = await sequelize.query<{ sequence: string }>(
      `SELECT nextval('"${schema}"."finding_code_seq"')::text AS sequence`,
      { type: QueryTypes.SELECT, transaction },
    );
    const date = new Date();
    const period = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
    return `FND-${period}-${String(row.sequence).padStart(6, '0')}`;
  }

  private async nextActionCode(transaction: Transaction): Promise<string> {
    const schema = this.schema().replace(/"/g, '""');
    const [row] = await sequelize.query<{ sequence: string }>(
      `SELECT nextval('"${schema}"."remediation_action_code_seq"')::text AS sequence`,
      { type: QueryTypes.SELECT, transaction },
    );
    const date = new Date();
    const period = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
    return `ACT-${period}-${String(row.sequence).padStart(6, '0')}`;
  }

  async createForReview(
    item: QuestionItem,
    input: FindingReviewInput | undefined,
    user: RequestUser,
    transaction: Transaction,
  ): Promise<Finding> {
    if (!input?.description?.trim() || !input.severity || !Object.values(RiskLevel).includes(input.severity)) {
      throw new AppError(400, 'FINDING_REQUIRED', '部分符合或不符合时必须填写不符合项描述和严重度');
    }
    const ownerDepartmentId = input.ownerDepartmentId || item.responsibleDepartmentId;
    const ownerUserId = input.ownerUserId || item.assignedTo;
    if (!ownerUserId) throw new AppError(400, 'FINDING_OWNER_REQUIRED', '不符合项必须指定责任人');
    const department = await Department.findOne({ where: { id: ownerDepartmentId, status: 'active' }, transaction });
    const member = await TenantMember.findOne({ where: { userId: ownerUserId, status: TenantMemberStatus.ACTIVE }, transaction });
    if (!department || !member) throw new AppError(404, 'NOT_FOUND', '不符合项责任部门或责任人无效');
    const existing = await Finding.findOne({ where: { evaluationId: item.id }, transaction, lock: transaction.LOCK.UPDATE });
    if (existing) {
      if (![FindingStatus.OPEN, FindingStatus.CANCELLED].includes(existing.status)
        || ![FindingDisposition.PENDING].includes(existing.disposition)) {
        throw new AppError(409, 'FINDING_ALREADY_PROCESSED', '该评估项的不符合项已进入下游处置，不能重新生成');
      }
      await existing.update({
        title: input.title?.trim() || item.controlPoint.slice(0, 200),
        description: input.description.trim(),
        severity: input.severity,
        ownerDepartmentId,
        ownerUserId,
        dueDate: input.dueDate || null,
        status: FindingStatus.OPEN,
        disposition: FindingDisposition.PENDING,
        resolvedBy: null,
        resolvedAt: null,
        resolutionComment: null,
        lockVersion: existing.lockVersion + 1,
      }, { transaction });
      return existing;
    }
    return Finding.create({
      code: await this.nextCode(transaction),
      taskId: item.taskId,
      evaluationId: item.id,
      title: input.title?.trim() || item.controlPoint.slice(0, 200),
      description: input.description.trim(),
      severity: input.severity,
      ownerDepartmentId,
      ownerUserId,
      dueDate: input.dueDate || null,
      createdBy: user.userId,
    }, { transaction });
  }

  async list(query: Record<string, unknown>, user: RequestUser) {
    const { page, pageSize } = parsePagination(query as any);
    const where: any = await objectAccessService.findingScope(user);
    if (query.taskId) where.taskId = query.taskId;
    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;
    if (query.ownerUserId) where.ownerUserId = query.ownerUserId;
    if (query.keyword) where[Op.or] = [
      { code: { [Op.iLike]: `%${query.keyword}%` } },
      { title: { [Op.iLike]: `%${query.keyword}%` } },
    ];
    const { rows, count } = await Finding.findAndCountAll({
      where,
      include: [
        { association: 'evaluation', attributes: ['id', 'sequenceNumber', 'controlDomain', 'controlPoint', 'assetId'] },
        { association: 'actionLinks', include: [{ association: 'action' }] },
        { association: 'riskLinks', include: [{ association: 'risk' }] },
      ],
      order: [['createdAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      distinct: true,
    });
    return { items: rows, pagination: pagination(page, pageSize, count) };
  }

  async detail(id: string, user: RequestUser) {
    await objectAccessService.findingOrNotFound(id, user);
    const finding = await Finding.findByPk(id, {
      include: [
        { association: 'evaluation' },
        { association: 'actionLinks', include: [{ association: 'action' }] },
        { association: 'riskLinks', include: [{ association: 'risk' }] },
      ],
    });
    if (!finding) throw new AppError(404, 'NOT_FOUND', '不符合项不存在');
    const json: any = finding.toJSON();
    if (json.evaluation?.assetId) {
      const snapshot = await AssessmentAsset.findOne({ where: { taskId: finding.taskId, assetId: json.evaluation.assetId } });
      json.evaluation.asset = snapshot ? {
        id: snapshot.assetId,
        code: snapshot.assetCodeSnapshot,
        name: snapshot.assetNameSnapshot,
        assetType: snapshot.assetTypeSnapshot,
        ownerDepartmentId: snapshot.ownerDepartmentIdSnapshot,
        ownerDepartmentName: snapshot.ownerDepartmentNameSnapshot,
      } : null;
    }
    return json;
  }

  async remediate(
    id: string,
    input: {
      actionId?: string;
      title?: string;
      description?: string;
      ownerUserId?: string;
      ownerDepartmentId?: string;
      dueDate?: Date;
      contributionDescription?: string;
    },
    user: RequestUser,
    expectedLockVersion: number,
    rawIdempotencyKey?: string,
  ) {
    const visible = await objectAccessService.findingOrNotFound(id, user);
    if (visible.status !== FindingStatus.OPEN) {
      throw new AppError(409, 'CONFLICT', '只有待处置的不符合项可以创建直接整改');
    }
    if (![FindingDisposition.PENDING, FindingDisposition.DIRECT_REMEDIATION].includes(visible.disposition)) {
      throw new AppError(409, 'CONFLICT', '已升级为风险的不符合项不能改为直接整改');
    }
    if (!input.actionId) {
      await lookupService.assertOwners(
        'finding-remediation-owner',
        input.ownerDepartmentId || visible.ownerDepartmentId,
        input.ownerUserId || visible.ownerUserId,
        user,
        id,
      );
    }
    const idempotencyKey = idempotencyService.requireKey(rawIdempotencyKey);
    const result = await idempotencyService.execute(
      'finding.remediate',
      idempotencyKey,
      user.userId,
      { id, input, expectedLockVersion },
      async (transaction) => {
      const finding = await Finding.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!finding) throw new AppError(404, 'NOT_FOUND', '不符合项不存在');
      assertLockVersion(finding.lockVersion, expectedLockVersion);
      let target: RemediationAction | null = null;
      if (input.actionId) {
        await objectAccessService.remediationOrNotFound(input.actionId, user, 'read');
        target = await RemediationAction.findByPk(input.actionId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!target || [RemediationActionStatus.COMPLETED, RemediationActionStatus.CANCELLED].includes(target.status)) {
          throw new AppError(404, 'NOT_FOUND', '整改行动不存在或已结束');
        }
      } else {
        const ownerUserId = input.ownerUserId || finding.ownerUserId;
        const ownerDepartmentId = input.ownerDepartmentId || finding.ownerDepartmentId;
        if (!input.title?.trim() || !input.description?.trim() || !input.dueDate) {
          throw new AppError(400, 'VALIDATION_ERROR', '整改标题、措施和期限必填');
        }
        const department = await Department.findOne({ where: { id: ownerDepartmentId, status: 'active' }, transaction });
        const member = await TenantMember.findOne({ where: { userId: ownerUserId, status: TenantMemberStatus.ACTIVE }, transaction });
        if (!department || !member) throw new AppError(404, 'NOT_FOUND', '整改责任部门或责任人无效');
        target = await RemediationAction.create({
          code: await this.nextActionCode(transaction),
          title: input.title.trim(),
          description: input.description.trim(),
          ownerUserId,
          ownerDepartmentId,
          dueDate: input.dueDate,
          status: RemediationActionStatus.NOT_STARTED,
          createdBy: user.userId,
        }, { transaction });
      }
      await FindingActionLink.findOrCreate({
        where: { findingId: id, actionId: target.id },
        defaults: {
          findingId: id,
          actionId: target.id,
          isRequired: true,
          contributionDescription: input.contributionDescription?.trim() || '完成该不符合项整改',
        },
        transaction,
      });
      await finding.update({
        disposition: FindingDisposition.DIRECT_REMEDIATION,
        status: FindingStatus.REMEDIATING,
        lockVersion: finding.lockVersion + 1,
      }, { transaction });
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.CREATE,
        resourceType: 'finding_remediation',
        resourceId: id,
        operationDetails: `不符合项 ${visible.code} 进入直接整改`,
        success: true,
        departmentId: visible.ownerDepartmentId,
      }, transaction);
      return { resourceId: target.id };
      },
    );
    const action = await RemediationAction.findByPk(result.value.resourceId);
    if (!action) throw new AppError(500, 'INTERNAL_ERROR', '整改行动创建结果不存在');
    if (!result.replayed) {
      await notificationService.create({
        userId: action.ownerUserId,
        taskId: visible.taskId,
        type: 'remediation_assigned' as any,
        title: '新的整改行动已分配',
        content: `${action.code} ${action.title}`,
      });
    }
    return this.detail(id, user);
  }

  async verifyAction(
    findingId: string,
    actionId: string,
    input: { decision: VerificationStatus; comment?: string },
    user: RequestUser,
    expectedLockVersion: number,
  ) {
    const finding = await objectAccessService.findingOrNotFound(findingId, user);
    if (![VerificationStatus.APPROVED, VerificationStatus.REJECTED].includes(input.decision)) {
      throw new AppError(400, 'VALIDATION_ERROR', '复核结论必须为通过或驳回');
    }
    if (input.decision === VerificationStatus.REJECTED && !input.comment?.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', '驳回时必须填写原因');
    }
    await sequelize.transaction(async (transaction) => {
      const action = await RemediationAction.findByPk(actionId, { transaction, lock: transaction.LOCK.UPDATE });
      const link = await FindingActionLink.findOne({ where: { findingId, actionId }, transaction, lock: transaction.LOCK.UPDATE });
      const lockedFinding = await Finding.findByPk(findingId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!action || !link || !lockedFinding) throw new AppError(404, 'NOT_FOUND', '不符合项整改关联不存在');
      if (action.ownerUserId === user.userId) throw new AppError(403, 'SELF_REVIEW_FORBIDDEN', '整改负责人不能复核自己的整改');
      assertLockVersion(action.lockVersion, expectedLockVersion);
      if (action.status !== RemediationActionStatus.PENDING_VERIFICATION) {
        throw new AppError(409, 'CONFLICT', '整改行动尚未提交复核');
      }
      await link.update({
        verificationStatus: input.decision,
        verifiedBy: user.userId,
        verifiedAt: new Date(),
        reviewComment: input.comment?.trim() || null,
      }, { transaction });
      if (input.decision === VerificationStatus.REJECTED) {
        await action.update({ status: RemediationActionStatus.IN_PROGRESS, completedAt: null, lockVersion: action.lockVersion + 1 }, { transaction });
        await lockedFinding.update({ status: FindingStatus.REMEDIATING, lockVersion: lockedFinding.lockVersion + 1 }, { transaction });
        return;
      }
      const pendingFindingLinks = await FindingActionLink.count({
        where: { actionId, isRequired: true, verificationStatus: { [Op.ne]: VerificationStatus.APPROVED } },
        transaction,
      });
      const pendingRiskLinks = await RiskActionLink.count({
        where: { actionId, isRequired: true, verificationStatus: { [Op.ne]: VerificationStatus.APPROVED } },
        transaction,
      });
      if (pendingFindingLinks === 0 && pendingRiskLinks === 0) {
        await action.update({ status: RemediationActionStatus.COMPLETED, completedAt: new Date(), lockVersion: action.lockVersion + 1 }, { transaction });
      }
      const unresolvedLinks = await FindingActionLink.count({
        where: { findingId, isRequired: true, verificationStatus: { [Op.ne]: VerificationStatus.APPROVED } },
        transaction,
      });
      if (unresolvedLinks === 0) {
        await lockedFinding.update({
          status: FindingStatus.RESOLVED,
          resolvedBy: user.userId,
          resolvedAt: new Date(),
          resolutionComment: input.comment?.trim() || '整改验证通过',
          lockVersion: lockedFinding.lockVersion + 1,
        }, { transaction });
      }
    });
    await auditLogService.log({
      userId: user.userId,
      operationType: OperationType.UPDATE,
      resourceType: 'finding_remediation',
      resourceId: findingId,
      operationDetails: `${input.decision === VerificationStatus.APPROVED ? '通过' : '驳回'}不符合项整改 ${actionId}`,
      success: true,
      departmentId: finding.ownerDepartmentId,
    });
    return this.detail(findingId, user);
  }

  async reconcileRisk(riskId: string, userId: string, transaction: Transaction) {
    const risk = await RiskRecord.findByPk(riskId, { transaction });
    if (!risk || ![RiskLifecycleStatus.CLOSED, RiskLifecycleStatus.ACCEPTED].includes(risk.status)) return;
    const links = await RiskFindingLink.findAll({ where: { riskId }, transaction });
    for (const link of links) {
      const otherOpen = await RiskFindingLink.count({
        where: { findingId: link.findingId, riskId: { [Op.ne]: riskId } },
        include: [{ association: 'risk', where: { status: { [Op.notIn]: [RiskLifecycleStatus.CLOSED, RiskLifecycleStatus.ACCEPTED] } } }],
        transaction,
      });
      if (otherOpen === 0) {
        await Finding.update({
          status: FindingStatus.RESOLVED,
          resolvedBy: userId,
          resolvedAt: new Date(),
          resolutionComment: risk.status === RiskLifecycleStatus.ACCEPTED ? '关联风险已接受' : '关联风险已关闭',
        }, { where: { id: link.findingId, status: FindingStatus.ESCALATED }, transaction });
      }
    }
  }
}

export default new FindingService();
