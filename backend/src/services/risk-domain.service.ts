import { Op, QueryTypes } from 'sequelize';
import sequelize from '../config/database';
import { getTenantStore } from '../middlewares/tenant';
import {
  Asset,
  AuditTask,
  Finding,
  FindingDisposition,
  FindingStatus,
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
  RiskCreationMode,
  RiskDiscoverySource,
  RiskLifecycleStatus,
  RiskLevel,
  RiskFindingLink,
  RiskRecord,
  RiskSource,
  TenantMember,
  TenantMemberStatus,
  TreatmentStrategy,
  User,
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
import lookupService from './lookup.service';
import riskReviewerEligibility from './risk-reviewer-eligibility.service';

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
  taskId?: string | null;
  creationMode?: unknown;
  discoverySource?: RiskDiscoverySource;
  discoverySourceDetail?: string | null;
  sourceReference?: string | null;
  reviewerUserId?: string | null;
  title: string;
  description: string;
  riskLevel: RiskLevel;
  treatmentStrategy?: TreatmentStrategy;
  ownerDepartmentId: string;
  ownerUserId: string;
  dueDate?: Date | null;
  sources?: SourceInput[];
  assets: AffectedAssetInput[];
}

interface EscalateFindingsInput {
  findingIds: string[];
  title: string;
  description: string;
  riskLevel: RiskLevel;
  treatmentStrategy?: TreatmentStrategy;
  ownerDepartmentId: string;
  ownerUserId: string;
  dueDate?: Date | null;
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

  private async validateReviewer(userId: string | null | undefined, transaction?: any) {
    await riskReviewerEligibility.assertEligible(userId, transaction);
  }

  private async validateAssets(assets: AffectedAssetInput[] | undefined, transaction?: any) {
    if (!Array.isArray(assets) || !assets.length) {
      throw new AppError(400, 'VALIDATION_ERROR', '风险至少需要一个受影响资产');
    }
    const ids = [...new Set(assets.map((asset) => asset.assetId))];
    if (ids.length !== assets.length) throw new AppError(409, 'CONFLICT', '受影响资产不能重复');
    const count = await Asset.count({ where: { id: { [Op.in]: ids }, status: 'active' }, transaction });
    if (count !== ids.length) throw new AppError(404, 'NOT_FOUND', '受影响资产不存在或已归档');
  }

  private async actorMap(rows: RiskRecord[]) {
    if (!rows.length) return { departments: new Map<string, string>(), members: new Map<string, string>() };
    const departmentIds = [...new Set(rows.map((row) => row.ownerDepartmentId))];
    const userIds = [...new Set(rows.flatMap((row) => [row.ownerUserId, row.reviewerUserId, row.createdBy]).filter(Boolean))] as string[];
    const [departments, members, users] = await Promise.all([
      Department.findAll({ where: { id: { [Op.in]: departmentIds } }, attributes: ['id', 'name'] }),
      TenantMember.findAll({ where: { userId: { [Op.in]: userIds } }, attributes: ['userId', 'displayName'] }),
      User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ['id', 'username'] }),
    ]);
    const memberNames = new Map(members.map((row) => [row.userId, row.displayName]));
    users.forEach((row) => { if (!memberNames.has(row.id)) memberNames.set(row.id, row.username); });
    return {
      departments: new Map(departments.map((row) => [row.id, row.name])),
      members: memberNames,
    };
  }

  private attachActors(row: RiskRecord, maps: Awaited<ReturnType<RiskDomainService['actorMap']>>) {
    return {
      ...row.toJSON(),
      ownerDepartment: { id: row.ownerDepartmentId, name: maps.departments.get(row.ownerDepartmentId) || '未知部门' },
      owner: { id: row.ownerUserId, displayName: maps.members.get(row.ownerUserId) || '未知成员' },
      reviewer: row.reviewerUserId
        ? { id: row.reviewerUserId, displayName: maps.members.get(row.reviewerUserId) || '未知成员' }
        : null,
      creator: { id: row.createdBy, displayName: maps.members.get(row.createdBy) || '未知成员' },
    };
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
      where: {
        id: { [Op.in]: assetIds },
        status: 'active',
        ...(await objectAccessService.assetScope(user, 'read') as object),
      },
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

  private async synchronizeSources(risk: RiskRecord, sources: SourceInput[], user: RequestUser, transaction: any) {
    const existingLinks = await RiskFindingLink.findAll({ where: { riskId: risk.id }, transaction, lock: transaction.LOCK.UPDATE });
    const existingIds = new Set(existingLinks.map((link) => link.findingId));
    // Lock the union in a stable order so two risks cannot concurrently take the same finding.
    const findings = await Finding.findAll({
      where: { [Op.or]: [
        { id: { [Op.in]: [...existingIds] } },
        { evaluationId: { [Op.in]: sources.map((source) => source.controlEvaluationId) } },
      ] },
      order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE,
    });
    const byEvaluation = new Map(findings.map((finding) => [finding.evaluationId, finding]));
    const desired = sources.map((source) => byEvaluation.get(source.controlEvaluationId));
    if (desired.some((finding) => !finding || finding.taskId !== risk.taskId)) {
      throw new AppError(409, 'CONFLICT', '来源评估单元缺少对应不符合项，不能创建评估风险');
    }
    const selected = desired as Finding[];
    for (const finding of selected) {
      const retained = existingIds.has(finding.id);
      if (retained
        ? finding.disposition !== FindingDisposition.RISK || finding.status !== FindingStatus.ESCALATED
        : finding.disposition !== FindingDisposition.PENDING || finding.status !== FindingStatus.OPEN) {
        throw new AppError(409, 'CONFLICT', '新增来源只能选择待处置且未解决的不符合项，保留来源必须仍处于风险处置中');
      }
    }
    const selectedIds = new Set(selected.map((finding) => finding.id));
    const removed = findings.filter((finding) => existingIds.has(finding.id) && !selectedIds.has(finding.id));
    await RiskSource.destroy({ where: { riskId: risk.id }, transaction });
    await RiskFindingLink.destroy({ where: { riskId: risk.id }, transaction });
    const normalized = sources.map((source, index) => ({
      ...source, relationType: source.relationType || (index === 0 ? 'primary' as const : 'supporting' as const),
      rationale: source.rationale || null,
    }));
    await RiskSource.bulkCreate(normalized.map((source) => ({
      riskId: risk.id, ...source, createdBy: user.userId,
    })), { transaction });
    await RiskFindingLink.bulkCreate(normalized.map((source) => ({
      riskId: risk.id, findingId: byEvaluation.get(source.controlEvaluationId)!.id,
      relationType: source.relationType, rationale: source.rationale, createdBy: user.userId,
    })), { transaction });
    for (const [index, finding] of selected.entries()) {
      const previous = existingLinks.find((link) => link.findingId === finding.id);
      const source = normalized[index];
      // Relationship changes also invalidate a finding's optimistic lock, even if its status is unchanged.
      if (!previous || previous.relationType !== source.relationType || (previous.rationale || null) !== source.rationale) {
        await finding.update({ disposition: FindingDisposition.RISK, status: FindingStatus.ESCALATED, lockVersion: finding.lockVersion + 1 }, { transaction });
      }
    }
    for (const finding of removed) {
      const restorePending = finding.disposition === FindingDisposition.RISK && finding.status === FindingStatus.ESCALATED
        && !await RiskFindingLink.count({ where: { findingId: finding.id }, transaction });
      await finding.update({
        ...(restorePending ? { disposition: FindingDisposition.PENDING, status: FindingStatus.OPEN } : {}),
        lockVersion: finding.lockVersion + 1,
      }, { transaction });
    }
  }

  async list(query: Record<string, unknown>, user: RequestUser) {
    const { page, pageSize } = parsePagination(query as any);
    const accessWhere = await objectAccessService.riskScope(user);
    const where: any = { [Op.and]: [accessWhere] };
    if (query.status) where.status = query.status;
    if (query.riskLevel) where.riskLevel = query.riskLevel;
    if (query.treatmentStrategy) where.treatmentStrategy = query.treatmentStrategy;
    if (query.ownerDepartmentId) where.ownerDepartmentId = query.ownerDepartmentId;
    if (query.taskId) where.taskId = query.taskId;
    if (query.creationMode) where.creationMode = query.creationMode;
    if (query.discoverySource) where.discoverySource = query.discoverySource;
    if (query.mine === 'true' || query.mine === true) where[Op.and].push(
      { [Op.or]: [{ ownerUserId: user.userId }, { reviewerUserId: user.userId }, { createdBy: user.userId }] },
    );
    if (query.overdue === 'true' || query.overdue === true) {
      where.dueDate = { [Op.lt]: new Date() };
      where[Op.and].push({ status: { [Op.notIn]: [RiskLifecycleStatus.CLOSED, RiskLifecycleStatus.CANCELLED] } });
    }
    if (query.dateFrom || query.dateTo) where.identifiedAt = {
      ...(query.dateFrom ? { [Op.gte]: new Date(String(query.dateFrom)) } : {}),
      ...(query.dateTo ? { [Op.lte]: new Date(`${String(query.dateTo)}T23:59:59.999Z`) } : {}),
    };
    if (query.keyword) where[Op.and].push({ [Op.or]: [
      { code: { [Op.iLike]: `%${query.keyword}%` } },
      { title: { [Op.iLike]: `%${query.keyword}%` } },
    ] });
    const { rows, count } = await RiskRecord.findAndCountAll({
      where,
      order: [['identifiedAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const ids = rows.map((row) => row.id);
    const [sources, affectedAssets, actionLinks, findingLinks] = ids.length ? await Promise.all([
      RiskSource.findAll({ where: { riskId: { [Op.in]: ids } }, include: [{ association: 'controlEvaluation' }] }),
      RiskAffectedAsset.findAll({ where: { riskId: { [Op.in]: ids } }, include: [{ association: 'asset' }] }),
      RiskActionLink.findAll({ where: { riskId: { [Op.in]: ids } }, include: [{ association: 'action' }] }),
      RiskFindingLink.findAll({ where: { riskId: { [Op.in]: ids } }, include: [{ association: 'finding' }] }),
    ]) : [[], [], [], []];
    const attach = <T extends { riskId: string }>(riskId: string, values: T[]) => values.filter((value) => value.riskId === riskId);
    const actorMaps = await this.actorMap(rows);
    return {
      items: rows.map((row) => ({
        ...this.attachActors(row, actorMaps),
        sources: attach(row.id, sources as RiskSource[]),
        affectedAssets: attach(row.id, affectedAssets as RiskAffectedAsset[]),
        actionLinks: attach(row.id, actionLinks as RiskActionLink[]),
        findingLinks: attach(row.id, findingLinks as RiskFindingLink[]),
      })),
      pagination: pagination(page, pageSize, count),
    };
  }

  async detail(id: string, user: RequestUser) {
    const risk = await objectAccessService.riskOrNotFound(id, user);
    const [sources, affectedAssets, actionLinks, findingLinks] = await Promise.all([
      RiskSource.findAll({ where: { riskId: id }, include: [{ association: 'controlEvaluation' }] }),
      RiskAffectedAsset.findAll({ where: { riskId: id }, include: [{ association: 'asset' }] }),
      RiskActionLink.findAll({
        where: { riskId: id },
        include: [{ association: 'action', include: [{ association: 'evidenceFiles', where: { status: 'active' }, required: false }] }],
      }),
      RiskFindingLink.findAll({ where: { riskId: id }, include: [{ association: 'finding', include: [{ association: 'evaluation' }] }] }),
    ]);
    const actors = await this.actorMap([risk]);
    const task = risk.taskId ? await AuditTask.findByPk(risk.taskId, { attributes: ['id', 'name', 'assessmentTarget'] }) : null;
    return { ...this.attachActors(risk, actors), task, sources, affectedAssets, actionLinks, findingLinks };
  }

  async create(input: CreateRiskInput, user: RequestUser, rawIdempotencyKey?: string) {
    if (!input.title?.trim() || !input.description?.trim() || !input.ownerDepartmentId || !input.ownerUserId) {
      throw new AppError(400, 'VALIDATION_ERROR', '风险标题、描述、责任部门和负责人必填');
    }
    if (input.creationMode !== undefined) {
      throw new AppError(400, 'VALIDATION_ERROR', 'creationMode 由服务端生成，客户端不能指定');
    }
    if (!Object.values(RiskLevel).includes(input.riskLevel)) {
      throw new AppError(400, 'VALIDATION_ERROR', '风险等级无效');
    }
    if (input.treatmentStrategy && !Object.values(TreatmentStrategy).includes(input.treatmentStrategy)) {
      throw new AppError(400, 'VALIDATION_ERROR', '处置策略无效');
    }
    const hasTask = Boolean(input.taskId);
    const hasSources = Array.isArray(input.sources) && input.sources.length > 0;
    const isEvaluation = hasTask || hasSources;
    if (hasTask !== hasSources) {
      throw new AppError(400, 'VALIDATION_ERROR', '评估风险必须同时提供 taskId 和 sources，人工风险两者都不能提供');
    }
    if (isEvaluation) {
      if (input.discoverySource && input.discoverySource !== RiskDiscoverySource.COMPLIANCE_ASSESSMENT) {
        throw new AppError(400, 'VALIDATION_ERROR', '评估风险不能混用人工发现来源');
      }
      if (input.reviewerUserId) throw new AppError(400, 'VALIDATION_ERROR', '评估风险不能指定独立审核人');
      if (input.discoverySourceDetail || input.sourceReference) {
        throw new AppError(400, 'VALIDATION_ERROR', '评估风险不能混用人工来源说明或引用');
      }
      await objectAccessService.taskOrNotFound(input.taskId!, user, 'update');
    } else {
      if (input.sources !== undefined) throw new AppError(400, 'VALIDATION_ERROR', '人工风险不能提交评估来源关系');
      if (!Object.values(RiskDiscoverySource).includes(input.discoverySource as RiskDiscoverySource)) {
        throw new AppError(400, 'VALIDATION_ERROR', '发现来源无效');
      }
      if (!input.discoverySource || input.discoverySource === RiskDiscoverySource.COMPLIANCE_ASSESSMENT) {
        throw new AppError(400, 'VALIDATION_ERROR', '人工风险必须指定非合规评估的发现来源');
      }
      if (!input.discoverySourceDetail?.trim()) {
        throw new AppError(400, 'VALIDATION_ERROR', '人工风险必须填写来源说明');
      }
      if (input.reviewerUserId === user.userId || input.reviewerUserId === input.ownerUserId) {
        throw new AppError(400, 'VALIDATION_ERROR', '人工风险审核人必须独立于创建人和负责人');
      }
      await this.validateReviewer(input.reviewerUserId);
      await lookupService.assertSelectable('personnel', 'risk-reviewer', [input.reviewerUserId!], user);
      await lookupService.assertSelectable('assets', 'risk-assets', input.assets?.map((asset) => asset.assetId) || [], user);
    }
    await lookupService.assertOwners('risk-owner', input.ownerDepartmentId, input.ownerUserId, user);
    const idempotencyKey = idempotencyService.requireKey(rawIdempotencyKey);
    const result = await idempotencyService.execute(
      'risk.create',
      idempotencyKey,
      user.userId,
      input,
      async (transaction) => {
        await this.validateOwner(input.ownerDepartmentId, input.ownerUserId, transaction);
        if (isEvaluation) {
          await this.validateRelations(input.taskId!, input.sources!, input.assets, user, transaction);
        } else {
          await this.validateReviewer(input.reviewerUserId, transaction);
          await this.validateAssets(input.assets, transaction);
        }
        const created = await RiskRecord.create({
          code: await this.nextCode(transaction),
          taskId: isEvaluation ? input.taskId! : null,
          creationMode: isEvaluation ? RiskCreationMode.EVALUATION : RiskCreationMode.MANUAL,
          discoverySource: isEvaluation
            ? RiskDiscoverySource.COMPLIANCE_ASSESSMENT
            : input.discoverySource!,
          discoverySourceDetail: isEvaluation ? null : input.discoverySourceDetail!.trim(),
          sourceReference: isEvaluation ? null : input.sourceReference?.trim() || null,
          createdBy: user.userId,
          reviewerUserId: isEvaluation ? null : input.reviewerUserId!,
          title: input.title.trim(),
          description: input.description.trim(),
          riskLevel: input.riskLevel,
          treatmentStrategy: input.treatmentStrategy || TreatmentStrategy.MITIGATE,
          ownerDepartmentId: input.ownerDepartmentId,
          ownerUserId: input.ownerUserId,
          dueDate: input.dueDate || null,
          status: RiskLifecycleStatus.PENDING_CONFIRMATION,
        }, { transaction });
        if (isEvaluation) {
          await this.synchronizeSources(created, input.sources!, user, transaction);
        }
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
        const recipients = [...new Set([input.ownerUserId, isEvaluation ? null : input.reviewerUserId].filter(Boolean))] as string[];
        for (const recipient of recipients) {
          await notificationService.create({
            userId: recipient,
            taskId: created.taskId,
            type: recipient === input.reviewerUserId
              ? NotificationType.RISK_PENDING_CONFIRMATION
              : NotificationType.RISK_ASSIGNED,
            title: recipient === input.reviewerUserId ? '风险待确认' : '新的风险已分配',
            content: `${created.code} ${created.title}`,
          }, transaction);
        }
        return { resourceId: created.id };
      },
    );
    const risk = await RiskRecord.findByPk(result.value.resourceId);
    if (!risk) throw new AppError(500, 'INTERNAL_ERROR', '风险创建结果不存在');
    return this.detail(risk.id, user);
  }

  async createFromFindings(input: EscalateFindingsInput, user: RequestUser, rawIdempotencyKey?: string) {
    if (!input.title?.trim() || !input.description?.trim() || !Array.isArray(input.findingIds) || !input.findingIds.length) {
      throw new AppError(400, 'VALIDATION_ERROR', '风险标题、描述和不符合项必填');
    }
    if (!Object.values(RiskLevel).includes(input.riskLevel)) {
      throw new AppError(400, 'VALIDATION_ERROR', '风险等级无效');
    }
    const findingIds = [...new Set(input.findingIds)];
    if (findingIds.length !== input.findingIds.length) throw new AppError(409, 'CONFLICT', '不能重复选择不符合项');
    for (const id of findingIds) await objectAccessService.findingOrNotFound(id, user);
    await lookupService.assertOwners('finding-escalation-owner', input.ownerDepartmentId, input.ownerUserId, user);
    const idempotencyKey = idempotencyService.requireKey(rawIdempotencyKey);
    const result = await idempotencyService.execute(
      'risk.create_from_findings',
      idempotencyKey,
      user.userId,
      input,
      async (transaction) => {
        const findings = await Finding.findAll({
          where: { id: { [Op.in]: findingIds } },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (findings.length !== findingIds.length) throw new AppError(404, 'NOT_FOUND', '不符合项不存在');
        if (findings.some((finding) => finding.disposition !== FindingDisposition.PENDING || finding.status !== FindingStatus.OPEN)) {
          throw new AppError(409, 'CONFLICT', '只有待处置的不符合项可以升级为风险');
        }
        const taskIds = [...new Set(findings.map((finding) => finding.taskId))];
        if (taskIds.length !== 1) throw new AppError(400, 'VALIDATION_ERROR', '一次只能升级同一评估项目的不符合项');
        await objectAccessService.taskOrNotFound(taskIds[0], user, 'read');
        await this.validateOwner(input.ownerDepartmentId, input.ownerUserId, transaction);
        const created = await RiskRecord.create({
          code: await this.nextCode(transaction),
          taskId: taskIds[0],
          creationMode: RiskCreationMode.FINDING_ESCALATION,
          discoverySource: RiskDiscoverySource.COMPLIANCE_ASSESSMENT,
          discoverySourceDetail: null,
          sourceReference: null,
          createdBy: user.userId,
          reviewerUserId: null,
          title: input.title.trim(),
          description: input.description.trim(),
          riskLevel: input.riskLevel,
          treatmentStrategy: input.treatmentStrategy || TreatmentStrategy.MITIGATE,
          ownerDepartmentId: input.ownerDepartmentId,
          ownerUserId: input.ownerUserId,
          dueDate: input.dueDate || null,
          status: RiskLifecycleStatus.PENDING_CONFIRMATION,
        }, { transaction });
        const evaluationIds = [...new Set(findings.map((finding) => finding.evaluationId))];
        await this.synchronizeSources(created, evaluationIds.map((controlEvaluationId, index) => ({
          controlEvaluationId,
          relationType: index === 0 ? 'primary' as const : 'supporting' as const,
          rationale: '由不符合项升级同步关联评估单元',
        })), user, transaction);
        const evaluations = await QuestionItem.findAll({
          where: { id: { [Op.in]: evaluationIds } },
          attributes: ['id', 'assetId'],
          transaction,
        });
        const assetIds = [...new Set(evaluations.map((evaluation) => evaluation.assetId).filter(Boolean))] as string[];
        if (assetIds.length) {
          await RiskAffectedAsset.bulkCreate(assetIds.map((assetId) => ({
            riskId: created.id,
            assetId,
            impactLevel: null,
            impactDescription: null,
            createdBy: user.userId,
          })), { transaction });
        }
        await auditLogService.log({
          userId: user.userId,
          operationType: OperationType.CREATE,
          resourceType: 'risk',
          resourceId: created.id,
          operationDetails: `从 ${findingIds.length} 个不符合项升级风险 ${created.code}`,
          relatedResourceIds: { findingIds },
          success: true,
          departmentId: created.ownerDepartmentId,
        }, transaction);
        await notificationService.create({
          userId: created.ownerUserId,
          taskId: created.taskId,
          type: NotificationType.RISK_ASSIGNED,
          title: '新的风险已分配',
          content: `${created.code} ${created.title}`,
        }, transaction);
        return { resourceId: created.id };
      },
    );
    const risk = await RiskRecord.findByPk(result.value.resourceId);
    if (!risk) throw new AppError(500, 'INTERNAL_ERROR', '风险创建结果不存在');
    return this.detail(risk.id, user);
  }

  async update(
    id: string,
    input: Partial<CreateRiskInput>,
    user: RequestUser,
    expectedLockVersion: number,
  ) {
    await objectAccessService.riskOrNotFound(id, user, 'update');
    await sequelize.transaction(async (transaction) => {
      const risk = await RiskRecord.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!risk) throw new AppError(404, 'NOT_FOUND', '风险记录不存在');
      assertLockVersion(risk.lockVersion, expectedLockVersion);
      if (risk.status !== RiskLifecycleStatus.PENDING_CONFIRMATION) {
        throw new AppError(409, 'CONFLICT', '只有待确认风险可以编辑');
      }
      if (input.creationMode !== undefined || input.taskId !== undefined || input.sources !== undefined) {
        throw new AppError(400, 'VALIDATION_ERROR', '创建方式、评估项目和评估来源不能通过基础信息接口修改');
      }
      if (input.reviewerUserId !== undefined) {
        throw new AppError(400, 'VALIDATION_ERROR', '审核人只能通过独立的分配接口修改');
      }
      const ownerDepartmentId = input.ownerDepartmentId || risk.ownerDepartmentId;
      const ownerUserId = input.ownerUserId || risk.ownerUserId;
      if (input.ownerDepartmentId || input.ownerUserId) {
        await lookupService.assertOwners('risk-owner', ownerDepartmentId, ownerUserId, user, id);
        await this.validateOwner(ownerDepartmentId, ownerUserId, transaction);
      }
      const changes: any = {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.riskLevel !== undefined ? { riskLevel: input.riskLevel } : {}),
        ...(input.treatmentStrategy !== undefined ? { treatmentStrategy: input.treatmentStrategy } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate || null } : {}),
        ownerDepartmentId,
        ownerUserId,
        lockVersion: risk.lockVersion + 1,
      };
      if (input.riskLevel && !Object.values(RiskLevel).includes(input.riskLevel)) {
        throw new AppError(400, 'VALIDATION_ERROR', '风险等级无效');
      }
      if (input.treatmentStrategy && !Object.values(TreatmentStrategy).includes(input.treatmentStrategy)) {
        throw new AppError(400, 'VALIDATION_ERROR', '处置策略无效');
      }
      if (!changes.title && input.title !== undefined) throw new AppError(400, 'VALIDATION_ERROR', '风险标题不能为空');
      if (!changes.description && input.description !== undefined) throw new AppError(400, 'VALIDATION_ERROR', '风险描述不能为空');
      if (risk.creationMode === RiskCreationMode.MANUAL) {
        if (risk.reviewerUserId === ownerUserId) {
          throw new AppError(400, 'VALIDATION_ERROR', '人工风险审核人必须独立于负责人');
        }
        if (input.discoverySource === RiskDiscoverySource.COMPLIANCE_ASSESSMENT) {
          throw new AppError(400, 'VALIDATION_ERROR', '人工风险不能使用合规评估来源');
        }
        if (input.discoverySource && !Object.values(RiskDiscoverySource).includes(input.discoverySource)) {
          throw new AppError(400, 'VALIDATION_ERROR', '发现来源无效');
        }
        const detail = input.discoverySourceDetail === undefined
          ? risk.discoverySourceDetail
          : input.discoverySourceDetail?.trim() || null;
        if (!detail) throw new AppError(400, 'VALIDATION_ERROR', '人工风险必须填写来源说明');
        Object.assign(changes, {
          ...(input.discoverySource !== undefined ? { discoverySource: input.discoverySource } : {}),
          discoverySourceDetail: detail,
          ...(input.sourceReference !== undefined ? { sourceReference: input.sourceReference?.trim() || null } : {}),
        });
      } else if (input.discoverySource !== undefined || input.discoverySourceDetail !== undefined || input.sourceReference !== undefined) {
        throw new AppError(409, 'CONFLICT', '评估风险的来源由评估关系确定，不能修改');
      }
      if (input.assets !== undefined) {
        await this.validateAssets(input.assets, transaction);
        await RiskAffectedAsset.destroy({ where: { riskId: id }, transaction });
        await RiskAffectedAsset.bulkCreate(input.assets.map((asset) => ({
          riskId: id,
          assetId: asset.assetId,
          impactLevel: asset.impactLevel || null,
          impactDescription: asset.impactDescription || null,
          createdBy: user.userId,
        })), { transaction });
      }
      const before = risk.toJSON();
      await risk.update(changes, { transaction });
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'risk',
        resourceId: id,
        operationDetails: `编辑风险 ${risk.code}`,
        relatedResourceIds: { before, changedFields: Object.keys(input) },
        success: true,
        departmentId: risk.ownerDepartmentId,
      }, transaction);
    });
    return this.detail(id, user);
  }

  async assignReviewer(id: string, reviewerUserId: string, user: RequestUser, expectedLockVersion: number) {
    await objectAccessService.riskOrNotFound(id, user, 'assign');
    await this.validateReviewer(reviewerUserId);
    await lookupService.assertSelectable('personnel', 'risk-reviewer', [reviewerUserId], user, id);
    await sequelize.transaction(async (transaction) => {
      const risk = await RiskRecord.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!risk) throw new AppError(404, 'NOT_FOUND', '风险记录不存在');
      assertLockVersion(risk.lockVersion, expectedLockVersion);
      if (risk.creationMode !== RiskCreationMode.MANUAL || risk.status !== RiskLifecycleStatus.PENDING_CONFIRMATION) {
        throw new AppError(409, 'CONFLICT', '只有待确认的人工风险可以分配审核人');
      }
      if (reviewerUserId === risk.createdBy || reviewerUserId === risk.ownerUserId) {
        throw new AppError(400, 'VALIDATION_ERROR', '人工风险审核人必须独立于创建人和负责人');
      }
      await this.validateReviewer(reviewerUserId, transaction);
      const previous = risk.reviewerUserId;
      await risk.update({ reviewerUserId, lockVersion: risk.lockVersion + 1 }, { transaction });
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'risk',
        resourceId: id,
        operationDetails: `分配风险审核人：${previous || '无'} -> ${reviewerUserId}`,
        success: true,
        departmentId: risk.ownerDepartmentId,
      }, transaction);
      await notificationService.create({
        userId: reviewerUserId,
        taskId: null,
        type: NotificationType.RISK_PENDING_CONFIRMATION,
        title: '风险待确认',
        content: `${risk.code} ${risk.title}`,
      }, transaction);
    });
    return this.detail(id, user);
  }

  async replaceSources(
    id: string,
    sources: SourceInput[],
    user: RequestUser,
    expectedLockVersion: number,
  ) {
    const visible = await objectAccessService.riskOrNotFound(id, user, 'update');
    const risk = visible;
    if (risk.creationMode === RiskCreationMode.MANUAL) {
      throw new AppError(409, 'CONFLICT', '人工风险不使用评估单元来源关系');
    }
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
      const affectedAssets = await RiskAffectedAsset.findAll({ where: { riskId: id }, transaction });
      const before = await RiskSource.findAll({ where: { riskId: id }, transaction, lock: transaction.LOCK.UPDATE });
      await this.validateRelations(
        locked.taskId!,
        sources,
        affectedAssets.map((row) => ({ assetId: row.assetId })),
        user,
        transaction,
      );
      await this.synchronizeSources(locked, sources, user, transaction);
      await locked.update({ lockVersion: locked.lockVersion + 1 }, { transaction });
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'risk',
        resourceId: id,
        operationDetails: `更新风险来源：${before.map((row) => row.controlEvaluationId).join(',')} -> ${sources.map((row) => row.controlEvaluationId).join(',')}`,
        relatedResourceIds: { before: before.map((row) => row.toJSON()), sources, controlEvaluationIds: sources.map((row) => row.controlEvaluationId) },
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
      const sources = await RiskSource.findAll({ where: { riskId: id }, transaction });
      const before = await RiskAffectedAsset.findAll({ where: { riskId: id }, transaction, lock: transaction.LOCK.UPDATE });
      if (locked.creationMode === RiskCreationMode.MANUAL) await this.validateAssets(assets, transaction);
      else await this.validateRelations(
        locked.taskId!,
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
    const visible = await objectAccessService.riskOrNotFound(id, user, 'confirm');
    const confirmAll = user.isGlobalAdmin || user.permissionScopes?.risks?.confirm === 'all';
    if (visible.creationMode === RiskCreationMode.MANUAL && visible.reviewerUserId !== user.userId && !confirmAll) {
      throw new AppError(404, 'NOT_FOUND', '风险记录不存在');
    }
    const risk = await sequelize.transaction(async (transaction) => {
      const locked = await RiskRecord.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!locked) throw new AppError(404, 'NOT_FOUND', '风险记录不存在');
      assertLockVersion(locked.lockVersion, expectedLockVersion);
      if (locked.status !== RiskLifecycleStatus.PENDING_CONFIRMATION) {
        throw new AppError(409, 'CONFLICT', '只有待确认风险可以确认');
      }
      const assetCount = await RiskAffectedAsset.count({ where: { riskId: id }, transaction });
      if (!assetCount) throw new AppError(409, 'CONFIRM_GATE_FAILED', '风险至少需要一个受影响资产');
      await this.validateOwner(locked.ownerDepartmentId, locked.ownerUserId, transaction);
      if (locked.creationMode === RiskCreationMode.MANUAL) {
        await this.validateReviewer(locked.reviewerUserId, transaction);
        if (locked.reviewerUserId === locked.createdBy || locked.reviewerUserId === locked.ownerUserId
          || (locked.reviewerUserId !== user.userId && !confirmAll)) {
          throw new AppError(409, 'CONFIRM_GATE_FAILED', '人工风险审核人必须独立且与当前确认权限一致');
        }
        if (locked.taskId || locked.discoverySource === RiskDiscoverySource.COMPLIANCE_ASSESSMENT
          || !locked.discoverySourceDetail?.trim()) {
          throw new AppError(409, 'CONFIRM_GATE_FAILED', '人工风险的发现来源或审核人信息不完整');
        }
      } else {
        const sources = await RiskSource.findAll({ where: { riskId: id }, transaction, lock: transaction.LOCK.UPDATE });
        if (!locked.taskId || locked.discoverySource !== RiskDiscoverySource.COMPLIANCE_ASSESSMENT || !sources.length) {
          throw new AppError(409, 'CONFIRM_GATE_FAILED', '评估风险的项目或评估来源关系不完整');
        }
        const links = await RiskFindingLink.findAll({ where: { riskId: id }, transaction, lock: transaction.LOCK.UPDATE });
        const findings = await Finding.findAll({ where: { id: { [Op.in]: links.map((link) => link.findingId) } }, transaction, lock: transaction.LOCK.UPDATE });
        const sourceIds = new Set(sources.map((source) => source.controlEvaluationId));
        if (links.length !== sourceIds.size || findings.length !== sourceIds.size
          || findings.some((finding) => !sourceIds.has(finding.evaluationId) || finding.taskId !== locked.taskId
            || finding.disposition !== FindingDisposition.RISK || finding.status !== FindingStatus.ESCALATED)) {
          throw new AppError(409, 'CONFIRM_GATE_FAILED', '评估来源与不符合项关系不一致或不符合项已失效');
        }
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
      const findingService = (await import('./finding.service')).default;
      await findingService.reconcileRisk(risk.id, user.userId, transaction);
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
      const findingService = (await import('./finding.service')).default;
      await findingService.reconcileRisk(risk.id, user.userId, transaction);
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
      const locked = await RiskRecord.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!locked || ![RiskLifecycleStatus.DRAFT, RiskLifecycleStatus.PENDING_CONFIRMATION].includes(locked.status)) {
        throw new AppError(409, 'CONFLICT', '已确认风险不能删除');
      }
      const findingLinks = await RiskFindingLink.findAll({ where: { riskId: id }, transaction });
      const findings = await Finding.findAll({
        where: { id: { [Op.in]: findingLinks.map((link) => link.findingId) } },
        order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE,
      });
      const sources = await RiskSource.findAll({ where: { riskId: id }, transaction });
      const sourceSummary = risk.creationMode === RiskCreationMode.MANUAL
        ? { discoverySource: risk.discoverySource, detail: risk.discoverySourceDetail, reference: risk.sourceReference }
        : { taskId: risk.taskId, evaluationIds: sources.map((source) => source.controlEvaluationId) };
      await RiskSource.destroy({ where: { riskId: id }, transaction });
      await RiskAffectedAsset.destroy({ where: { riskId: id }, transaction });
      await RiskFindingLink.destroy({ where: { riskId: id }, transaction });
      for (const finding of findings) {
        if (finding.disposition === FindingDisposition.RISK && finding.status === FindingStatus.ESCALATED
          && !await RiskFindingLink.count({ where: { findingId: finding.id }, transaction })) {
          await finding.update({ disposition: FindingDisposition.PENDING, status: FindingStatus.OPEN, lockVersion: finding.lockVersion + 1 }, { transaction });
        }
      }
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.DELETE,
        resourceType: 'risk',
        resourceId: id,
        operationDetails: `删除待确认风险 ${risk.code}`,
        relatedResourceIds: { sourceSummary },
        success: true,
        departmentId: risk.ownerDepartmentId,
      }, transaction);
      await locked.destroy({ transaction });
    });
  }
}

export default new RiskDomainService();
