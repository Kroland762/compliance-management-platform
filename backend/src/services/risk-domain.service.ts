import { Op, QueryTypes } from 'sequelize';
import sequelize from '../config/database';
import { getTenantStore } from '../middlewares/tenant';
import {
  Asset,
  ComplianceStatus,
  Department,
  EvaluationWorkflowStatus,
  NotificationType,
  OperationType,
  QuestionItem,
  RemediationAction,
  RemediationActionStatus,
  RiskActionLink,
  RiskAffectedAsset,
  RiskLifecycleStatus,
  RiskLevel,
  RiskRecord,
  RiskSource,
  TenantMember,
  TenantMemberStatus,
  TreatmentStrategy,
  VerificationStatus,
} from '../models';
import { AppError } from '../utils/http';
import { pagination, parsePagination } from '../utils/pagination';
import auditLogService from './audit-log.service';
import notificationService from './notification.service';
import objectAccessService from './object-access.service';
import { riskConfirmations } from './metrics.service';
import { assertLockVersion } from '../utils/optimistic-lock';
import idempotencyService from './idempotency.service';

type RequestUser = NonNullable<Express.Request['user']>;

interface SourceInput {
  controlEvaluationId: string;
  relationType?: 'primary' | 'supporting';
  rationale?: string | null;
}

interface AffectedAssetInput {
  assetId: string;
  impactLevel?: string | null;
  impactDescription?: string | null;
}

interface CreateRiskInput {
  taskId: string;
  title: string;
  description: string;
  riskLevel: RiskLevel;
  treatmentStrategy?: TreatmentStrategy;
  ownerDepartmentId: string;
  ownerUserId: string;
  dueDate?: Date | null;
  sources: SourceInput[];
  assets: AffectedAssetInput[];
}

class RiskDomainService {
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
      `SELECT nextval('"${schema}"."risk_code_seq"')::text AS sequence`,
      { type: QueryTypes.SELECT, transaction },
    );
    const date = new Date();
    const period = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
    return `RISK-${period}-${String(row.sequence).padStart(6, '0')}`;
  }

  private async validateOwner(departmentId: string, userId: string, transaction?: any) {
    const department = await Department.findOne({ where: { id: departmentId, status: 'active' }, transaction });
    const member = await TenantMember.findOne({ where: { userId, status: TenantMemberStatus.ACTIVE }, transaction });
    if (!department || !member) throw new AppError(404, 'NOT_FOUND', '风险责任部门或负责人不存在');
  }

  private async validateRelations(
    taskId: string,
    sources: SourceInput[],
    assets: AffectedAssetInput[],
    user: RequestUser,
    transaction?: any,
  ) {
    if (!Array.isArray(sources) || !sources.length || !Array.isArray(assets) || !assets.length) {
      throw new AppError(400, 'VALIDATION_ERROR', '风险至少需要一个来源评估单元和一个受影响资产');
    }
    const sourceIds = [...new Set(sources.map((source) => source.controlEvaluationId))];
    const assetIds = [...new Set(assets.map((asset) => asset.assetId))];
    if (sourceIds.length !== sources.length || assetIds.length !== assets.length) {
      throw new AppError(409, 'CONFLICT', '风险来源或受影响资产不能重复');
    }
    const evaluationScope = await objectAccessService.evaluationScope(user, 'read');
    const evaluations = await QuestionItem.findAll({
      where: {
        id: { [Op.in]: sourceIds },
        taskId,
        workflowStatus: EvaluationWorkflowStatus.REVIEWED,
        complianceStatus: { [Op.in]: [ComplianceStatus.PARTIAL, ComplianceStatus.NON_COMPLIANT] },
        ...(evaluationScope as object),
      },
      transaction,
    });
    const activeAssets = await Asset.findAll({
      where: { id: { [Op.in]: assetIds }, status: 'active' },
      transaction,
    });
    if (evaluations.length !== sourceIds.length) {
      throw new AppError(
        404,
        'NOT_FOUND',
        '风险来源评估单元不存在、不可见、未审阅或结论不需要生成风险',
      );
    }
    if (activeAssets.length !== assetIds.length) {
      throw new AppError(404, 'NOT_FOUND', '受影响资产不存在或已归档');
    }
  }

  async list(query: Record<string, unknown>, user: RequestUser) {
    const { page, pageSize } = parsePagination(query as any);
    const where: any = await objectAccessService.riskScope(user);
    if (query.status) where.status = query.status;
    if (query.riskLevel) where.riskLevel = query.riskLevel;
    if (query.treatmentStrategy) where.treatmentStrategy = query.treatmentStrategy;
    if (query.ownerDepartmentId) where.ownerDepartmentId = query.ownerDepartmentId;
    if (query.keyword) where[Op.or] = [
      { code: { [Op.iLike]: `%${query.keyword}%` } },
      { title: { [Op.iLike]: `%${query.keyword}%` } },
    ];
    const { rows, count } = await RiskRecord.findAndCountAll({
      where,
      order: [['identifiedAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const ids = rows.map((row) => row.id);
    const [sources, affectedAssets, actionLinks] = ids.length ? await Promise.all([
      RiskSource.findAll({ where: { riskId: { [Op.in]: ids } }, include: [{ association: 'controlEvaluation' }] }),
      RiskAffectedAsset.findAll({ where: { riskId: { [Op.in]: ids } }, include: [{ association: 'asset' }] }),
      RiskActionLink.findAll({ where: { riskId: { [Op.in]: ids } }, include: [{ association: 'action' }] }),
    ]) : [[], [], []];
    const attach = <T extends { riskId: string }>(riskId: string, values: T[]) => values.filter((value) => value.riskId === riskId);
    return {
      items: rows.map((row) => ({
        ...row.toJSON(),
        sources: attach(row.id, sources as RiskSource[]),
        affectedAssets: attach(row.id, affectedAssets as RiskAffectedAsset[]),
        actionLinks: attach(row.id, actionLinks as RiskActionLink[]),
      })),
      pagination: pagination(page, pageSize, count),
    };
  }

  async detail(id: string, user: RequestUser) {
    const risk = await objectAccessService.riskOrNotFound(id, user);
    const [sources, affectedAssets, actionLinks] = await Promise.all([
      RiskSource.findAll({ where: { riskId: id }, include: [{ association: 'controlEvaluation' }] }),
      RiskAffectedAsset.findAll({ where: { riskId: id }, include: [{ association: 'asset' }] }),
      RiskActionLink.findAll({
        where: { riskId: id },
        include: [{ association: 'action', include: [{ association: 'evidenceFiles', where: { status: 'active' }, required: false }] }],
      }),
    ]);
    return { ...risk.toJSON(), sources, affectedAssets, actionLinks };
  }

  async create(input: CreateRiskInput, user: RequestUser, rawIdempotencyKey?: string) {
    if (!input.title?.trim() || !input.description?.trim() || !input.taskId) {
      throw new AppError(400, 'VALIDATION_ERROR', '风险标题、描述和评估必填');
    }
    await objectAccessService.taskOrNotFound(input.taskId, user, 'update');
    const idempotencyKey = idempotencyService.requireKey(rawIdempotencyKey);
    const result = await idempotencyService.execute(
      'risk.create',
      idempotencyKey,
      user.userId,
      input,
      async (transaction) => {
        await this.validateOwner(input.ownerDepartmentId, input.ownerUserId, transaction);
        await this.validateRelations(input.taskId, input.sources, input.assets, user, transaction);
        const created = await RiskRecord.create({
          code: await this.nextCode(transaction),
          taskId: input.taskId,
          title: input.title.trim(),
          description: input.description.trim(),
          riskLevel: input.riskLevel,
          treatmentStrategy: input.treatmentStrategy || TreatmentStrategy.MITIGATE,
          ownerDepartmentId: input.ownerDepartmentId,
          ownerUserId: input.ownerUserId,
          dueDate: input.dueDate || null,
          status: RiskLifecycleStatus.PENDING_CONFIRMATION,
        }, { transaction });
        await RiskSource.bulkCreate(input.sources.map((source, index) => ({
          riskId: created.id,
          controlEvaluationId: source.controlEvaluationId,
          relationType: source.relationType || (index === 0 ? 'primary' : 'supporting'),
          rationale: source.rationale || null,
          createdBy: user.userId,
        })), { transaction });
        await RiskAffectedAsset.bulkCreate(input.assets.map((asset) => ({
          riskId: created.id,
          assetId: asset.assetId,
          impactLevel: asset.impactLevel || null,
          impactDescription: asset.impactDescription || null,
          createdBy: user.userId,
        })), { transaction });
        await auditLogService.log({
          userId: user.userId,
          operationType: OperationType.CREATE,
          resourceType: 'risk',
          resourceId: created.id,
          operationDetails: `创建风险 ${created.code}`,
          success: true,
          departmentId: created.ownerDepartmentId,
        }, transaction);
        return { resourceId: created.id };
      },
    );
    const risk = await RiskRecord.findByPk(result.value.resourceId);
    if (!risk) throw new AppError(500, 'INTERNAL_ERROR', '风险创建结果不存在');
    if (!result.replayed) {
      await notificationService.create({
        userId: input.ownerUserId,
        taskId: input.taskId,
        type: 'risk_assigned' as any,
        title: '新的风险已分配',
        content: `${risk.code} ${risk.title}`,
      } as any);
    }
    return this.detail(risk.id, user);
  }

  async replaceSources(
    id: string,
    sources: SourceInput[],
    user: RequestUser,
    expectedLockVersion: number,
  ) {
    const visible = await objectAccessService.riskOrNotFound(id, user, 'update');
    const risk = visible;
    if (![RiskLifecycleStatus.DRAFT, RiskLifecycleStatus.PENDING_CONFIRMATION].includes(risk.status)) {
      throw new AppError(409, 'CONFLICT', '风险确认后不能修改来源关系');
    }
    await sequelize.transaction(async (transaction) => {
      const locked = await RiskRecord.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!locked) throw new AppError(404, 'NOT_FOUND', '风险记录不存在');
      assertLockVersion(locked.lockVersion, expectedLockVersion);
      if (![RiskLifecycleStatus.DRAFT, RiskLifecycleStatus.PENDING_CONFIRMATION].includes(locked.status)) {
        throw new AppError(409, 'CONFLICT', '风险确认后不能修改来源关系');
      }
      const [affectedAssets, before] = await Promise.all([
        RiskAffectedAsset.findAll({ where: { riskId: id }, transaction }),
        RiskSource.findAll({ where: { riskId: id }, transaction, lock: transaction.LOCK.UPDATE }),
      ]);
      await this.validateRelations(
        locked.taskId,
        sources,
        affectedAssets.map((row) => ({ assetId: row.assetId })),
        user,
        transaction,
      );
      await RiskSource.destroy({ where: { riskId: id }, transaction });
      await RiskSource.bulkCreate(sources.map((source, index) => ({
        riskId: id,
        controlEvaluationId: source.controlEvaluationId,
        relationType: source.relationType || (index === 0 ? 'primary' : 'supporting'),
        rationale: source.rationale || null,
        createdBy: user.userId,
      })), { transaction });
      await locked.update({ lockVersion: locked.lockVersion + 1 }, { transaction });
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'risk',
        resourceId: id,
        operationDetails: `更新风险来源：${before.map((row) => row.controlEvaluationId).join(',')} -> ${sources.map((row) => row.controlEvaluationId).join(',')}`,
        relatedResourceIds: { controlEvaluationIds: sources.map((row) => row.controlEvaluationId) },
        success: true,
        departmentId: locked.ownerDepartmentId,
      }, transaction);
    });
    return this.detail(id, user);
  }

  async replaceAssets(
    id: string,
    assets: AffectedAssetInput[],
    user: RequestUser,
    expectedLockVersion: number,
  ) {
    const risk = await objectAccessService.riskOrNotFound(id, user, 'update');
    if (![RiskLifecycleStatus.DRAFT, RiskLifecycleStatus.PENDING_CONFIRMATION].includes(risk.status)) {
      throw new AppError(409, 'CONFLICT', '风险确认后不能修改受影响资产');
    }
    await sequelize.transaction(async (transaction) => {
      const locked = await RiskRecord.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!locked) throw new AppError(404, 'NOT_FOUND', '风险记录不存在');
      assertLockVersion(locked.lockVersion, expectedLockVersion);
      if (![RiskLifecycleStatus.DRAFT, RiskLifecycleStatus.PENDING_CONFIRMATION].includes(locked.status)) {
        throw new AppError(409, 'CONFLICT', '风险确认后不能修改受影响资产');
      }
      const [sources, before] = await Promise.all([
        RiskSource.findAll({ where: { riskId: id }, transaction }),
        RiskAffectedAsset.findAll({ where: { riskId: id }, transaction, lock: transaction.LOCK.UPDATE }),
      ]);
      await this.validateRelations(
        locked.taskId,
        sources.map((row) => ({ controlEvaluationId: row.controlEvaluationId })),
        assets,
        user,
        transaction,
      );
      await RiskAffectedAsset.destroy({ where: { riskId: id }, transaction });
      await RiskAffectedAsset.bulkCreate(assets.map((asset) => ({
        riskId: id,
        assetId: asset.assetId,
        impactLevel: asset.impactLevel || null,
        impactDescription: asset.impactDescription || null,
        createdBy: user.userId,
      })), { transaction });
      await locked.update({ lockVersion: locked.lockVersion + 1 }, { transaction });
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'risk',
        resourceId: id,
        operationDetails: `更新受影响资产：${before.map((row) => row.assetId).join(',')} -> ${assets.map((row) => row.assetId).join(',')}`,
        relatedResourceIds: { assetIds: assets.map((row) => row.assetId) },
        success: true,
        departmentId: locked.ownerDepartmentId,
      }, transaction);
    });
    return this.detail(id, user);
  }

  async confirm(id: string, user: RequestUser, expectedLockVersion: number) {
    await objectAccessService.riskOrNotFound(id, user, 'confirm');
    const risk = await sequelize.transaction(async (transaction) => {
      const locked = await RiskRecord.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!locked) throw new AppError(404, 'NOT_FOUND', '风险记录不存在');
      assertLockVersion(locked.lockVersion, expectedLockVersion);
      if (locked.status !== RiskLifecycleStatus.PENDING_CONFIRMATION) {
        throw new AppError(409, 'CONFLICT', '只有待确认风险可以确认');
      }
      await locked.update({
        status: RiskLifecycleStatus.OPEN,
        confirmedBy: user.userId,
        confirmedAt: new Date(),
        lockVersion: locked.lockVersion + 1,
      }, { transaction });
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'risk',
        resourceId: locked.id,
        operationDetails: `确认风险 ${locked.code}`,
        success: true,
        departmentId: locked.ownerDepartmentId,
      }, transaction);
      return locked;
    });
    riskConfirmations.inc({ outcome: 'success' });
    return risk;
  }

  async accept(
    id: string,
    reason: string,
    reviewDueDate: Date,
    user: RequestUser,
    expectedLockVersion: number,
  ) {
    await objectAccessService.riskOrNotFound(id, user, 'accept');
    if (!reason?.trim() || !reviewDueDate) {
      throw new AppError(400, 'VALIDATION_ERROR', '接受原因和复查日期必填');
    }
    const risk = await sequelize.transaction(async (transaction) => {
      const risk = await RiskRecord.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!risk) throw new AppError(404, 'NOT_FOUND', '风险记录不存在');
      assertLockVersion(risk.lockVersion, expectedLockVersion);
      if (![RiskLifecycleStatus.OPEN, RiskLifecycleStatus.REMEDIATING].includes(risk.status)) {
        throw new AppError(409, 'CONFLICT', '当前风险状态不能接受');
      }
      await risk.update({
        treatmentStrategy: TreatmentStrategy.ACCEPT,
        status: RiskLifecycleStatus.ACCEPTED,
        acceptedBy: user.userId,
        acceptedAt: new Date(),
        acceptanceReason: reason.trim(),
        reviewDueDate,
        lockVersion: risk.lockVersion + 1,
      }, { transaction });
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'risk',
        resourceId: risk.id,
        operationDetails: `接受风险 ${risk.code}`,
        success: true,
        departmentId: risk.ownerDepartmentId,
      }, transaction);
      return risk;
    });
    const scheduler = (await import('./account/cronScheduler.service')).default;
    await scheduler.registerResourceJob('risk_review', risk.id, '0 9 * * *');
    return risk;
  }

  async sendAcceptedRiskReviewReminder(id: string): Promise<{ disableSchedule: boolean }> {
    const risk = await RiskRecord.findByPk(id);
    if (!risk || risk.status !== RiskLifecycleStatus.ACCEPTED || !risk.reviewDueDate) {
      return { disableSchedule: true };
    }
    const due = new Date(risk.reviewDueDate);
    const today = new Date();
    due.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    if (due.getTime() > today.getTime()) return { disableSchedule: false };
    await notificationService.create({
      userId: risk.ownerUserId,
      taskId: risk.taskId,
      type: NotificationType.RISK_REVIEW_DUE,
      title: '已接受风险到期复查',
      content: `${risk.code} ${risk.title} 已到复查日期，请重新确认处置结论`,
    });
    await auditLogService.log({
      userId: risk.ownerUserId,
      operationType: OperationType.CREATE,
      resourceType: 'risk_review_reminder',
      resourceId: risk.id,
      operationDetails: `发送已接受风险 ${risk.code} 的到期复查提醒`,
      success: true,
      departmentId: risk.ownerDepartmentId,
    });
    return { disableSchedule: true };
  }

  async close(
    id: string,
    comment: string | undefined,
    user: RequestUser,
    expectedLockVersion: number,
  ) {
    await objectAccessService.riskOrNotFound(id, user, 'close');
    return sequelize.transaction(async (transaction) => {
      const risk = await RiskRecord.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!risk) throw new AppError(404, 'NOT_FOUND', '风险记录不存在');
      assertLockVersion(risk.lockVersion, expectedLockVersion);
      if (![RiskLifecycleStatus.REMEDIATING, RiskLifecycleStatus.PENDING_VERIFICATION].includes(risk.status)) {
        throw new AppError(409, 'CLOSE_GATE_FAILED', '当前风险状态不能关闭');
      }
      const requiredLinks = await RiskActionLink.findAll({
        where: { riskId: id, isRequired: true },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!requiredLinks.length) {
        throw new AppError(409, 'CLOSE_GATE_FAILED', '风险至少需要一个必要整改行动');
      }
      const actions = await RemediationAction.findAll({
        where: { id: { [Op.in]: requiredLinks.map((link) => link.actionId) } },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const actionStatus = new Map(actions.map((action) => [action.id, action.status]));
      const incomplete = requiredLinks.filter((link) =>
        link.verificationStatus !== VerificationStatus.APPROVED
        || actionStatus.get(link.actionId) !== RemediationActionStatus.COMPLETED);
      if (incomplete.length) {
        throw new AppError(409, 'CLOSE_GATE_FAILED', '所有必要行动完成且逐风险复核通过后才能关闭');
      }
      await risk.update({
        status: RiskLifecycleStatus.CLOSED,
        closedBy: user.userId,
        closedAt: new Date(),
        closeComment: comment?.trim() || null,
        lockVersion: risk.lockVersion + 1,
      }, { transaction });
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'risk',
        resourceId: risk.id,
        operationDetails: `关闭风险 ${risk.code}`,
        success: true,
        departmentId: risk.ownerDepartmentId,
      }, transaction);
      return risk;
    });
  }

  async remove(id: string, user: RequestUser) {
    const risk = await objectAccessService.riskOrNotFound(id, user, 'update');
    if (![RiskLifecycleStatus.DRAFT, RiskLifecycleStatus.PENDING_CONFIRMATION].includes(risk.status)) {
      throw new AppError(409, 'CONFLICT', '已确认风险不能删除');
    }
    await sequelize.transaction(async (transaction) => {
      await RiskSource.destroy({ where: { riskId: id }, transaction });
      await RiskAffectedAsset.destroy({ where: { riskId: id }, transaction });
      await risk.destroy({ transaction });
    });
  }
}

export default new RiskDomainService();
