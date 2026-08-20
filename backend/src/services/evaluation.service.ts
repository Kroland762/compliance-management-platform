import { col, fn, Op, Transaction, where as sqlWhere } from 'sequelize';
import sequelize from '../config/database';
import {
  AuditTask,
  AssessmentAsset,
  AssessmentAuditor,
  AnswerStatus,
  ComplianceStatus,
  EvaluationWorkflowStatus,
  EvaluationAsset,
  EvaluationHistoryLink,
  EvidenceFile,
  EvidenceStatus,
  EvidenceType,
  Finding,
  FindingActionLink,
  FindingDisposition,
  FindingStatus,
  OperationType,
  QuestionItem,
  RiskFindingLink,
  RiskSource,
  TaskStatus,
  TenantMember,
} from '../models';
import { AppError } from '../utils/http';
import { decrypt, encrypt } from '../utils/crypto';
import { pagination, parsePagination } from '../utils/pagination';
import auditLogService from './audit-log.service';
import notificationService from './notification.service';
import objectAccessService from './object-access.service';
import { assertLockVersion } from '../utils/optimistic-lock';
import findingService, { type FindingReviewInput } from './finding.service';
import taskLifecycleService from './task-lifecycle.service';
import { normalizeEvaluationColumnSchema } from '../utils/evaluation-columns';
import { parseEvaluationQuery, type EvaluationFilters } from '../utils/evaluation-filters';
import memberContextService from './member-context.service';
import lookupService from './lookup.service';

type RequestUser = NonNullable<Express.Request['user']>;

class EvaluationService {
  private canReviewOwnEvaluation(user: RequestUser) {
    return user.isGlobalAdmin || Boolean(user.permissions?.evaluations?.includes('review'));
  }

  private canManageReviewPool(user: RequestUser) {
    return user.isGlobalAdmin || Boolean(user.permissions?.tasks?.includes('update'));
  }

  private canReviewWhileFilling(user: RequestUser) {
    return user.isGlobalAdmin || Boolean(
      user.permissions?.evaluations?.includes('answer')
      && user.permissions?.evaluations?.includes('review'),
    );
  }

  private async assigneesFor(items: QuestionItem[]) {
    const userIds = [...new Set(items.map((item) => item.assignedTo).filter(Boolean))] as string[];
    if (!userIds.length) return new Map<string, { userId: string; displayName: string }>();
    const members = await TenantMember.findAll({
      where: { userId: { [Op.in]: userIds } },
      attributes: ['userId', 'displayName'],
    });
    return new Map(members.map((member) => [member.userId, {
      userId: member.userId,
      displayName: member.displayName,
    }]));
  }

  private safe(
    item: QuestionItem,
    assetSnapshots: AssessmentAsset[] = [],
    assignees = new Map<string, { userId: string; displayName: string }>(),
  ): Record<string, unknown> {
    const json: any = item.toJSON();
    if (json.currentStatusDescription) json.currentStatusDescription = decrypt(json.currentStatusDescription);
    json.evidenceFiles = (json.evidenceFiles || [])
      .filter((file: any) => file.status === 'active')
      .map(({ filePath: _path, storageKey: _key, storedFilename: _stored, ...file }: any) => file);
    json.selfReview = Boolean(item.reviewedBy && item.reviewedBy === item.assignedTo);
    json.assignee = item.assignedTo
      ? assignees.get(item.assignedTo) || { userId: item.assignedTo, displayName: item.responsiblePerson || item.assignedTo }
      : null;
    json.assets = assetSnapshots.map((assetSnapshot) => ({
      id: assetSnapshot.assetId,
      code: assetSnapshot.assetCodeSnapshot,
      name: assetSnapshot.assetNameSnapshot,
      assetType: assetSnapshot.assetTypeSnapshot,
      ownerDepartmentId: assetSnapshot.ownerDepartmentIdSnapshot,
      ownerDepartmentName: assetSnapshot.ownerDepartmentNameSnapshot,
    }));
    json.asset = json.assets[0] || undefined;
    json.historyCount = json.historyLinks?.length || 0;
    if (json.finding) {
      json.finding = {
        id: json.finding.id,
        status: json.finding.status,
        description: json.finding.description,
        severity: json.finding.severity,
      };
    }
    delete json.evaluationAssets;
    return json;
  }

  private async snapshotsFor(items: QuestionItem[]) {
    const links = items.flatMap((item) => ((item as any).evaluationAssets || []) as EvaluationAsset[]);
    const taskIds = [...new Set(items.map((item) => item.taskId))];
    const assetIds = [...new Set(links.map((link) => link.assetId))];
    const snapshots = taskIds.length && assetIds.length ? await AssessmentAsset.findAll({
      where: { taskId: { [Op.in]: taskIds }, assetId: { [Op.in]: assetIds } },
    }) : [];
    const snapshotMap = new Map(snapshots.map((snapshot) => [`${snapshot.taskId}:${snapshot.assetId}`, snapshot]));
    return new Map(items.map((item) => [item.id, links
      .filter((link) => link.questionItemId === item.id)
      .map((link) => snapshotMap.get(`${item.taskId}:${link.assetId}`))
      .filter(Boolean) as AssessmentAsset[]]));
  }

  async list(taskId: string, query: Record<string, unknown>, user: RequestUser) {
    const task = await objectAccessService.taskOrNotFound(taskId, user);
    const { page, pageSize } = parsePagination(query as any);
    const parsed = parseEvaluationQuery(query);
    const scope = await objectAccessService.evaluationScope(user);
    const allowedDynamicKeys = new Set(normalizeEvaluationColumnSchema(task.columnSchemaSnapshot || [])
      .filter((column) => column.visible !== false && column.source === 'extra')
      .map((column) => column.key));
    for (const key of Object.keys(parsed.filters.columns || {})) {
      if (!allowedDynamicKeys.has(key)) throw new AppError(400, 'VALIDATION_ERROR', `不可筛选的模板列: ${key}`);
    }
    const clauses: any[] = [{ taskId }, scope];
    const filters = parsed.filters;
    if (query.assetId && !filters.assetIds) filters.assetIds = [String(query.assetId)];
    if (query.controlPointId) clauses.push({ templateQuestionId: query.controlPointId });
    if (query.workflowStatus && !filters.workflowStatuses) filters.workflowStatuses = [query.workflowStatus as EvaluationWorkflowStatus];
    if (query.complianceStatus && !filters.complianceStatuses) filters.complianceStatuses = [query.complianceStatus as ComplianceStatus];
    await this.addFilterClauses(taskId, filters, parsed.q, user, clauses);
    const queryWhere: any = { [Op.and]: clauses };
    const unfilteredTotal = await QuestionItem.count({ where: { [Op.and]: [{ taskId }, scope] } });
    const { rows, count } = await QuestionItem.findAndCountAll({
      where: queryWhere,
      include: [
        { association: 'evidenceFiles', where: { status: 'active' }, required: false },
        { association: 'evaluationAssets', required: false },
        { association: 'historyLinks', attributes: ['id'], required: false },
        {
          association: 'finding',
          attributes: ['id', 'status', 'description', 'severity'],
          where: { status: { [Op.ne]: FindingStatus.CANCELLED } },
          required: false,
        },
      ],
      order: [['sequenceNumber', 'ASC'], ['assetId', 'ASC'], ['id', 'ASC']],
      distinct: true,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const [snapshots, assignees] = await Promise.all([
      this.snapshotsFor(rows),
      this.assigneesFor(rows),
    ]);
    return {
      items: rows.map((row) => this.safe(row, snapshots.get(row.id), assignees)),
      pagination: pagination(page, pageSize, count),
      summary: { unfilteredTotal },
    };
  }

  private snapshotExpression(key: string) {
    const rawKey = key.slice('extraData.'.length);
    return fn('jsonb_extract_path_text', col('templateDataSnapshot'), 'extraData', rawKey);
  }

  private async addFilterClauses(
    taskId: string,
    filters: EvaluationFilters,
    q: string | undefined,
    user: RequestUser,
    clauses: any[],
  ) {
    if (q) clauses.push({ [Op.or]: [
      { sequenceNumber: { [Op.iLike]: `%${q}%` } },
      { controlPoint: { [Op.iLike]: `%${q}%` } },
      sqlWhere(fn('jsonb_extract_path_text', col('templateDataSnapshot'), 'extraData', '检查内容'), { [Op.iLike]: `%${q}%` }),
    ] });
    if (filters.sequenceNumber) clauses.push({ sequenceNumber: filters.sequenceNumber });
    if (filters.controlPoint) clauses.push({ controlPoint: { [Op.iLike]: `%${filters.controlPoint}%` } });
    if (filters.controlDomains?.length) clauses.push({ controlDomain: { [Op.in]: filters.controlDomains } });
    if (filters.workflowStatuses?.length) clauses.push({ workflowStatus: { [Op.in]: filters.workflowStatuses } });
    if (filters.complianceStatuses?.length) clauses.push({ complianceStatus: { [Op.in]: filters.complianceStatuses } });
    if (filters.answer) clauses.push({ answerStatus: filters.answer === 'answered' ? AnswerStatus.ANSWERED : AnswerStatus.PENDING });
    if (filters.mine) clauses.push({ [Op.or]: [
      { assignedTo: user.userId, workflowStatus: { [Op.in]: [EvaluationWorkflowStatus.PENDING, EvaluationWorkflowStatus.IN_PROGRESS, EvaluationWorkflowStatus.RETURNED] } },
      { reviewClaimedBy: user.userId, workflowStatus: EvaluationWorkflowStatus.SUBMITTED },
    ] });
    if (filters.assetIds?.length) {
      const links = await EvaluationAsset.findAll({ where: { taskId, assetId: { [Op.in]: filters.assetIds } }, attributes: ['questionItemId'], raw: true });
      clauses.push({ id: { [Op.in]: links.map((link: any) => link.questionItemId) } });
    }
    let taskItemIds: string[] | undefined;
    const itemIds = async () => {
      if (!taskItemIds) {
        const items = await QuestionItem.findAll({ where: { taskId }, attributes: ['id'], raw: true });
        taskItemIds = items.map((item: any) => item.id);
      }
      return taskItemIds;
    };
    if (filters.evidence) {
      const evidence = await EvidenceFile.findAll({
        where: { questionItemId: { [Op.in]: await itemIds() }, evidenceType: EvidenceType.CURRENT, status: EvidenceStatus.ACTIVE },
        attributes: ['questionItemId'], raw: true,
      });
      const ids = [...new Set(evidence.map((item: any) => item.questionItemId).filter(Boolean))];
      if (filters.evidence === 'present') clauses.push({ id: { [Op.in]: ids } });
      else if (ids.length) clauses.push({ id: { [Op.notIn]: ids } });
    }
    if (filters.history) {
      const links = await EvaluationHistoryLink.findAll({
        where: { currentEvaluationId: { [Op.in]: await itemIds() } },
        attributes: ['currentEvaluationId'], raw: true,
      });
      const ids = [...new Set(links.map((item: any) => item.currentEvaluationId))];
      if (filters.history === 'present') clauses.push({ id: { [Op.in]: ids } });
      else if (ids.length) clauses.push({ id: { [Op.notIn]: ids } });
    }
    for (const [key, condition] of Object.entries(filters.columns || {})) {
      const expression = this.snapshotExpression(key);
      if (condition.operator === 'in') {
        const selected = condition.values.length ? sqlWhere(expression, { [Op.in]: condition.values }) : undefined;
        const emptyValues = condition.includeEmpty
          ? [sqlWhere(expression, { [Op.is]: null }), sqlWhere(expression, '')]
          : [];
        clauses.push({ [Op.or]: [...(selected ? [selected] : []), ...emptyValues] });
      }
      if (condition.operator === 'contains') clauses.push(sqlWhere(expression, { [Op.iLike]: `%${condition.value}%` }));
      if (condition.operator === 'empty') {
        const empty = { [Op.or]: [sqlWhere(expression, { [Op.is]: null }), sqlWhere(expression, '')] };
        clauses.push(condition.value ? empty : { [Op.and]: [
          sqlWhere(expression, { [Op.not]: null }),
          sqlWhere(expression, { [Op.ne]: '' }),
        ] });
      }
    }
  }

  async filterOptions(taskId: string, user: RequestUser) {
    const task = await objectAccessService.taskOrNotFound(taskId, user);
    const scope = await objectAccessService.evaluationScope(user);
    const columns = normalizeEvaluationColumnSchema(task.columnSchemaSnapshot || [])
      .filter((column) => column.visible !== false && column.source === 'extra');
    const rows = await QuestionItem.findAll({
      where: { [Op.and]: [{ taskId }, scope] },
      attributes: ['controlDomain', 'templateDataSnapshot'],
    });
    const controlDomains = [...new Set(rows.map((row) => row.controlDomain).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const dynamicColumns: Record<string, { mode: 'select' | 'text'; options?: string[]; hasEmpty: boolean }> = {};
    for (const column of columns) {
      const rawKey = column.key.slice('extraData.'.length);
      const unique = new Set<string>();
      let hasEmpty = false;
      for (const row of rows) {
        const snapshot: any = row.templateDataSnapshot || {};
        const value = snapshot.extraData?.[rawKey];
        if (value === undefined || value === null || String(value).trim() === '') hasEmpty = true;
        else unique.add(String(value));
      }
      const sorted = [...unique].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      dynamicColumns[column.key] = sorted.length <= 50
        ? { mode: 'select', options: sorted, hasEmpty }
        : { mode: 'text', hasEmpty };
    }
    return { controlDomains, dynamicColumns };
  }

  async detail(id: string, user: RequestUser) {
    await objectAccessService.evaluationOrNotFound(id, user);
    const item = await QuestionItem.findByPk(id, {
      include: [
        { association: 'task' },
        { association: 'evidenceFiles', where: { status: 'active' }, required: false },
        { association: 'evaluationAssets', required: false },
        { association: 'historyLinks', attributes: ['id'], required: false },
        {
          association: 'finding',
          attributes: ['id', 'status', 'description', 'severity'],
          where: { status: { [Op.ne]: FindingStatus.CANCELLED } },
          required: false,
        },
      ],
    });
    if (!item) throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
    const [snapshots, assignees] = await Promise.all([
      this.snapshotsFor([item]),
      this.assigneesFor([item]),
    ]);
    return this.safe(item, snapshots.get(item.id), assignees);
  }

  private async refreshHistoryLinks(id: string, transaction?: Transaction) {
    const current = await QuestionItem.findByPk(id, {
      include: [
        { association: 'task', include: [{ association: 'template' }] },
        { association: 'evaluationAssets' },
      ],
      transaction,
    });
    if (!current?.controlKey) return;
    const currentTask: any = (current as any).task;
    const currentSeries = currentTask?.template?.standardSeriesKey;
    const currentAssetIds = new Set((((current as any).evaluationAssets || []) as EvaluationAsset[]).map((link) => link.assetId));
    await EvaluationHistoryLink.destroy({ where: { currentEvaluationId: id }, transaction });
    if (!currentSeries || !currentAssetIds.size) return;
    const candidates = await QuestionItem.findAll({
      where: {
        id: { [Op.ne]: id },
        controlKey: current.controlKey,
        workflowStatus: EvaluationWorkflowStatus.REVIEWED,
      },
      include: [
        { association: 'task', required: true, include: [{ association: 'template', required: true }] },
        { association: 'evaluationAssets', required: true },
      ],
      transaction,
    });
    const links = candidates.flatMap((source: any) => {
      const sourceTask = source.task;
      if (sourceTask.id === current.taskId || sourceTask.template?.standardSeriesKey !== currentSeries
        || new Date(sourceTask.createdAt) >= new Date(currentTask.createdAt)) return [];
      const matchedAssetIds = source.evaluationAssets.map((link: EvaluationAsset) => link.assetId)
        .filter((assetId: string) => currentAssetIds.has(assetId));
      return matchedAssetIds.length ? [{ currentEvaluationId: id, sourceEvaluationId: source.id, matchedAssetIds }] : [];
    });
    if (links.length) await EvaluationHistoryLink.bulkCreate(links, { transaction, ignoreDuplicates: true });
  }

  async refreshTaskHistoryLinks(taskId: string) {
    const items = await QuestionItem.findAll({ where: { taskId }, attributes: ['id'] });
    for (const item of items) await this.refreshHistoryLinks(item.id);
  }

  private async refreshFutureHistoryLinks(sourceId: string) {
    const source: any = await QuestionItem.findByPk(sourceId, {
      include: [
        { association: 'task', include: [{ association: 'template' }] },
        { association: 'evaluationAssets' },
      ],
    });
    if (!source?.controlKey || source.workflowStatus !== EvaluationWorkflowStatus.REVIEWED) return;
    const seriesKey = source.task?.template?.standardSeriesKey;
    const sourceAssets = new Set((source.evaluationAssets || []).map((link: any) => link.assetId));
    if (!seriesKey || !sourceAssets.size) return;
    const candidates: any[] = await QuestionItem.findAll({
      where: { controlKey: source.controlKey, id: { [Op.ne]: sourceId } },
      include: [
        { association: 'task', include: [{ association: 'template' }] },
        { association: 'evaluationAssets' },
      ],
    });
    for (const candidate of candidates) {
      if (candidate.task?.template?.standardSeriesKey !== seriesKey
        || new Date(candidate.task.createdAt) <= new Date(source.task.createdAt)
        || !(candidate.evaluationAssets || []).some((link: any) => sourceAssets.has(link.assetId))) continue;
      await this.refreshHistoryLinks(candidate.id);
    }
  }

  async history(id: string, user: RequestUser) {
    await objectAccessService.evaluationOrNotFound(id, user);
    await this.refreshHistoryLinks(id);
    const links = await EvaluationHistoryLink.findAll({
      where: { currentEvaluationId: id },
      include: [{
        association: 'sourceEvaluation',
        include: [
          { association: 'task', include: [{ association: 'template' }] },
          { association: 'evidenceFiles', where: { status: 'active' }, required: false },
          { association: 'evaluationAssets' },
        ],
      }],
    });
    const sources = links.map((link: any) => link.sourceEvaluation).filter(Boolean) as QuestionItem[];
    const [snapshots, assignees] = await Promise.all([
      this.snapshotsFor(sources),
      this.assigneesFor(sources),
    ]);
    return links.map((link: any) => ({
      ...this.safe(link.sourceEvaluation, snapshots.get(link.sourceEvaluation.id), assignees),
      matchedAssetIds: link.matchedAssetIds,
      task: {
        id: link.sourceEvaluation.task.id,
        name: link.sourceEvaluation.task.name,
        version: link.sourceEvaluation.task.template?.version,
        reviewedAt: link.sourceEvaluation.reviewedAt,
      },
    }));
  }

  async updateAssignee(id: string, assigneeUserId: string, expectedLockVersion: number, user: RequestUser) {
    if (!assigneeUserId) throw new AppError(400, 'VALIDATION_ERROR', '请选择责任人');
    const accessible = await objectAccessService.evaluationOrNotFound(id, user, 'read');
    await objectAccessService.taskOrNotFound(accessible.taskId, user, 'update');
    const assigneeContext = await memberContextService.resolve(assigneeUserId);
    if (!assigneeContext) throw new AppError(404, 'NOT_FOUND', '责任人不存在或已停用');
    let taskName = '评估项目';
    let changed = false;
    await sequelize.transaction(async (transaction) => {
      const item = await QuestionItem.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!item) throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      if (![EvaluationWorkflowStatus.PENDING, EvaluationWorkflowStatus.IN_PROGRESS, EvaluationWorkflowStatus.RETURNED].includes(item.workflowStatus)) {
        throw new AppError(409, 'CONFLICT', '已提交或已复核的评估单元不能改派责任人');
      }
      assertLockVersion(item.lockVersion, expectedLockVersion);
      await lookupService.assertSelectable('personnel', 'evaluation-assignment', [assigneeUserId], user);
      const task = await AuditTask.findByPk(item.taskId, { transaction });
      taskName = task?.name || task?.assessmentTarget || taskName;
      if (item.assignedTo === assigneeUserId) return;
      changed = true;
      await item.update({
        assignedTo: assigneeUserId,
        responsiblePerson: assigneeContext.member.displayName,
        responsibleDepartment: assigneeContext.primaryDepartmentName,
        responsibleDepartmentId: assigneeContext.primaryDepartmentId,
        lockVersion: item.lockVersion + 1,
      }, { transaction });
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'control_evaluation',
        resourceId: item.id,
        operationDetails: `改派评估单元责任人至 ${assigneeContext.member.displayName}`,
        success: true,
        departmentId: assigneeContext.primaryDepartmentId,
      }, transaction);
    });
    if (changed) await notificationService.notifyTaskAssigned(assigneeUserId, accessible.taskId, taskName);
    return this.detail(id, user);
  }

  async updateAssets(id: string, assetIds: string[], lockVersion: number, user: RequestUser) {
    await objectAccessService.evaluationOrNotFound(id, user, 'answer');
    const uniqueIds = [...new Set(assetIds || [])];
    if (!uniqueIds.length) throw new AppError(400, 'VALIDATION_ERROR', '评估行至少关联一个资产');
    await sequelize.transaction(async (transaction) => {
      const item = await QuestionItem.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!item) throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      if (![EvaluationWorkflowStatus.PENDING, EvaluationWorkflowStatus.IN_PROGRESS, EvaluationWorkflowStatus.RETURNED].includes(item.workflowStatus)) {
        throw new AppError(409, 'CONFLICT', '提交后不能修改资产关联');
      }
      assertLockVersion(item.lockVersion, lockVersion);
      const scoped = await AssessmentAsset.count({ where: { taskId: item.taskId, assetId: { [Op.in]: uniqueIds }, scopeStatus: 'included' }, transaction });
      if (scoped !== uniqueIds.length) throw new AppError(400, 'VALIDATION_ERROR', '只能关联本项目评估范围内的资产');
      const conflict = await EvaluationAsset.findOne({
        where: { taskId: item.taskId, templateQuestionId: item.templateQuestionId, assetId: { [Op.in]: uniqueIds }, questionItemId: { [Op.ne]: id } },
        transaction,
      });
      if (conflict) throw new AppError(409, 'ASSET_ALREADY_EVALUATED', '同一控制项下该资产已关联到其他评估行');
      await EvaluationAsset.destroy({ where: { questionItemId: id }, transaction });
      await EvaluationAsset.bulkCreate(uniqueIds.map((assetId) => ({ questionItemId: id, taskId: item.taskId, templateQuestionId: item.templateQuestionId, assetId })), { transaction });
      await item.update({ assetId: uniqueIds[0], lockVersion: item.lockVersion + 1 }, { transaction });
    });
    await this.refreshHistoryLinks(id);
    return this.detail(id, user);
  }

  async split(id: string, assetIds: string[], lockVersion: number, user: RequestUser) {
    await objectAccessService.evaluationOrNotFound(id, user, 'answer');
    let newId = '';
    await sequelize.transaction(async (transaction) => {
      const item = await QuestionItem.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!item) throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      if (![EvaluationWorkflowStatus.PENDING, EvaluationWorkflowStatus.IN_PROGRESS, EvaluationWorkflowStatus.RETURNED].includes(item.workflowStatus)) {
        throw new AppError(409, 'CONFLICT', '提交后不能拆分评估行');
      }
      assertLockVersion(item.lockVersion, lockVersion);
      const currentLinks = await EvaluationAsset.findAll({ where: { questionItemId: id }, transaction, lock: transaction.LOCK.UPDATE });
      const selected = [...new Set(assetIds || [])];
      const currentIds = new Set(currentLinks.map((link) => link.assetId));
      if (!selected.length || selected.length >= currentIds.size || selected.some((assetId) => !currentIds.has(assetId))) {
        throw new AppError(400, 'VALIDATION_ERROR', '请选择当前行中的部分资产进行拆分');
      }
      const created = await QuestionItem.create({
        taskId: item.taskId, templateQuestionId: item.templateQuestionId, assetId: selected[0],
        sequenceNumber: item.sequenceNumber, controlDomain: item.controlDomain, controlPoint: item.controlPoint,
        referenceAnswer: item.referenceAnswer, historicalEvidencePath: item.historicalEvidencePath,
        responsibleDepartment: item.responsibleDepartment, responsiblePerson: item.responsiblePerson,
        responsibleDepartmentId: item.responsibleDepartmentId, assignedTo: item.assignedTo,
        currentStatusDescription: item.currentStatusDescription, answerStatus: item.answerStatus,
        workflowStatus: item.workflowStatus, complianceStatus: ComplianceStatus.NOT_ASSESSED,
        controlKey: item.controlKey, templateDataSnapshot: item.templateDataSnapshot,
      }, { transaction });
      newId = created.id;
      await EvaluationAsset.update({ questionItemId: created.id }, { where: { questionItemId: id, assetId: { [Op.in]: selected } }, transaction });
      const remaining = currentLinks.find((link) => !selected.includes(link.assetId))!;
      await item.update({ assetId: remaining.assetId, lockVersion: item.lockVersion + 1 }, { transaction });
      await auditLogService.log({
        userId: user.userId, operationType: OperationType.CREATE, resourceType: 'control_evaluation', resourceId: created.id,
        operationDetails: `从评估单元 ${id} 拆分 ${selected.length} 个资产`, success: true, departmentId: item.responsibleDepartmentId,
      }, transaction);
    });
    await this.refreshHistoryLinks(id);
    await this.refreshHistoryLinks(newId);
    return { original: await this.detail(id, user), created: await this.detail(newId, user) };
  }

  async answer(id: string, description: string, lockVersion: number, user: RequestUser) {
    await objectAccessService.evaluationOrNotFound(id, user, 'answer');
    await sequelize.transaction(async (transaction) => {
      const item = await QuestionItem.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!item) throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      if (item.assignedTo !== user.userId && !user.isGlobalAdmin
        && user.permissionScopes?.evaluations?.answer !== 'all') {
        throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      }
      if ([EvaluationWorkflowStatus.SUBMITTED, EvaluationWorkflowStatus.REVIEWED].includes(item.workflowStatus)) {
        throw new AppError(409, 'CONFLICT', '已提交或已审阅的评估单元不能修改');
      }
      assertLockVersion(item.lockVersion, lockVersion);
      await item.update({
        currentStatusDescription: description?.trim() ? encrypt(description.trim()) : '',
        answerStatus: description?.trim() ? AnswerStatus.ANSWERED : AnswerStatus.PENDING,
        workflowStatus: description?.trim() ? EvaluationWorkflowStatus.IN_PROGRESS : EvaluationWorkflowStatus.PENDING,
        answeredAt: new Date(),
        lockVersion: item.lockVersion + 1,
      }, { transaction });
      const task = await AuditTask.findByPk(item.taskId, { transaction, lock: transaction.LOCK.UPDATE });
      if (task?.status === TaskStatus.READY) {
        await task.update({ status: TaskStatus.IN_PROGRESS }, { transaction });
      }
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'control_evaluation',
        resourceId: item.id,
        operationDetails: '保存评估单元回答',
        success: true,
        departmentId: item.responsibleDepartmentId,
      }, transaction);
    });
    return this.detail(id, user);
  }

  async submit(id: string, user: RequestUser, expectedLockVersion: number) {
    await objectAccessService.evaluationOrNotFound(id, user, 'submit');
    let reviewerNotifications: Array<{ userId: string; taskId: string; name: string }> = [];
    await sequelize.transaction(async (transaction) => {
      const item = await QuestionItem.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!item) throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      if (item.assignedTo !== user.userId && !user.isGlobalAdmin
        && user.permissionScopes?.evaluations?.submit !== 'all') {
        throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      }
      assertLockVersion(item.lockVersion, expectedLockVersion);
      if (!item.currentStatusDescription) throw new AppError(400, 'VALIDATION_ERROR', '请先填写现状说明');
      if (item.workflowStatus === EvaluationWorkflowStatus.REVIEWED) {
        throw new AppError(409, 'CONFLICT', '已审阅的评估单元不能重复提交');
      }
      await item.update({
        workflowStatus: EvaluationWorkflowStatus.SUBMITTED,
        submittedAt: new Date(),
        lockVersion: item.lockVersion + 1,
      }, { transaction });
      const remaining = await QuestionItem.count({
        where: {
          taskId: item.taskId,
          workflowStatus: { [Op.notIn]: [EvaluationWorkflowStatus.SUBMITTED, EvaluationWorkflowStatus.REVIEWED] },
        },
        transaction,
      });
      const task = await AuditTask.findByPk(item.taskId, { transaction, lock: transaction.LOCK.UPDATE });
      if (task && remaining === 0) {
        await task.update({ status: TaskStatus.PENDING_REVIEW, submittedAt: new Date() }, { transaction });
        const auditors = await AssessmentAuditor.findAll({ where: { taskId: task.id }, transaction });
        reviewerNotifications = auditors.map((auditor) => ({
          userId: auditor.auditorUserId,
          taskId: task.id,
          name: task.name || task.assessmentTarget,
        }));
      }
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'control_evaluation',
        resourceId: item.id,
        operationDetails: '提交评估单元复核',
        success: true,
        departmentId: item.responsibleDepartmentId,
      }, transaction);
    });
    for (const notice of reviewerNotifications) {
      await notificationService.notifyTaskSubmitted(notice.userId, notice.taskId, notice.name);
    }
    return this.detail(id, user);
  }

  async bulkSubmit(
    taskId: string,
    entries: Array<{ id: string; lockVersion: number; currentStatusDescription?: string }>,
    user: RequestUser,
  ) {
    await objectAccessService.taskOrNotFound(taskId, user);
    const normalized = entries || [];
    if (!normalized.length || new Set(normalized.map((entry) => entry.id)).size !== normalized.length) {
      throw new AppError(400, 'VALIDATION_ERROR', '请选择要提交的评估行');
    }
    let reviewerNotifications: Array<{ userId: string; taskId: string; name: string }> = [];
    await sequelize.transaction(async (transaction) => {
      const items = await QuestionItem.findAll({
        where: { id: { [Op.in]: normalized.map((entry) => entry.id) }, taskId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (items.length !== normalized.length) throw new AppError(404, 'NOT_FOUND', '部分评估行不存在');
      const entriesById = new Map(normalized.map((entry) => [entry.id, entry]));
      for (const item of items) {
        const entry = entriesById.get(item.id)!;
        if (entry.currentStatusDescription !== undefined && typeof entry.currentStatusDescription !== 'string') {
          throw new AppError(400, 'VALIDATION_ERROR', `控制项 ${item.sequenceNumber} 的现状说明格式无效`);
        }
        if (item.assignedTo !== user.userId && !user.isGlobalAdmin && user.permissionScopes?.evaluations?.submit !== 'all') {
          throw new AppError(403, 'FORBIDDEN', '只能提交本人负责的评估行');
        }
        assertLockVersion(item.lockVersion, entry.lockVersion);
        const description = entry.currentStatusDescription === undefined
          ? item.currentStatusDescription
          : entry.currentStatusDescription.trim();
        if (!description) throw new AppError(400, 'VALIDATION_ERROR', `控制项 ${item.sequenceNumber} 尚未填写`);
        if (![EvaluationWorkflowStatus.IN_PROGRESS, EvaluationWorkflowStatus.RETURNED].includes(item.workflowStatus)) {
          throw new AppError(409, 'CONFLICT', `控制项 ${item.sequenceNumber} 当前不能提交`);
        }
      }
      for (const item of items) {
        const entry = entriesById.get(item.id)!;
        const draft = entry.currentStatusDescription?.trim();
        await item.update({
          ...(entry.currentStatusDescription === undefined ? {} : {
            currentStatusDescription: encrypt(draft!),
            answerStatus: AnswerStatus.ANSWERED,
            answeredAt: new Date(),
          }),
          workflowStatus: EvaluationWorkflowStatus.SUBMITTED,
          submittedAt: new Date(),
          lockVersion: item.lockVersion + 1,
        }, { transaction });
      }
      const remaining = await QuestionItem.count({
        where: { taskId, workflowStatus: { [Op.notIn]: [EvaluationWorkflowStatus.SUBMITTED, EvaluationWorkflowStatus.REVIEWED] } },
        transaction,
      });
      const task = await AuditTask.findByPk(taskId, { transaction, lock: transaction.LOCK.UPDATE });
      if (task && remaining === 0) {
        await task.update({ status: TaskStatus.PENDING_REVIEW, submittedAt: new Date() }, { transaction });
        const auditors = await AssessmentAuditor.findAll({ where: { taskId }, transaction });
        reviewerNotifications = auditors.map((auditor) => ({ userId: auditor.auditorUserId, taskId, name: task.name || task.assessmentTarget }));
      } else if (task?.status === TaskStatus.READY) {
        await task.update({ status: TaskStatus.IN_PROGRESS }, { transaction });
      }
      await auditLogService.log({
        userId: user.userId, operationType: OperationType.UPDATE, resourceType: 'assessment', resourceId: taskId,
        operationDetails: `批量提交 ${items.length} 个评估行`, success: true, departmentId: task?.departmentId,
      }, transaction);
    });
    for (const notice of reviewerNotifications) await notificationService.notifyTaskSubmitted(notice.userId, notice.taskId, notice.name);
    return this.list(taskId, { page: 1, pageSize: 100 }, user);
  }

  async review(
    id: string,
    input: { complianceStatus?: ComplianceStatus; comment?: string; return?: boolean; finding?: FindingReviewInput },
    user: RequestUser,
    expectedLockVersion: number,
  ) {
    await objectAccessService.evaluationOrNotFound(id, user, 'review');
    if (!input.return && (!input.complianceStatus || !Object.values(ComplianceStatus).includes(input.complianceStatus))) {
      throw new AppError(400, 'VALIDATION_ERROR', '符合性结论无效');
    }
    await sequelize.transaction(async (transaction) => {
      const item = await QuestionItem.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!item) throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      assertLockVersion(item.lockVersion, expectedLockVersion);
      const directFillingReview = this.canReviewWhileFilling(user)
        && [EvaluationWorkflowStatus.IN_PROGRESS, EvaluationWorkflowStatus.RETURNED].includes(item.workflowStatus);
      if (!directFillingReview && item.workflowStatus !== EvaluationWorkflowStatus.SUBMITTED) {
        throw new AppError(409, 'CONFLICT', '当前状态不能设置符合性结论');
      }
      if (item.assignedTo === user.userId && !this.canReviewOwnEvaluation(user)) {
        throw new AppError(403, 'SELF_REVIEW_FORBIDDEN', '填写人不能复核自己的评估单元');
      }
      if (directFillingReview && input.return) {
        throw new AppError(400, 'VALIDATION_ERROR', '填写阶段直接复核不能退回本人');
      }
      if (directFillingReview && !String(item.currentStatusDescription || '').trim()) {
        throw new AppError(400, 'VALIDATION_ERROR', '请先填写现状说明');
      }
      if (!directFillingReview && item.reviewClaimedBy !== user.userId) {
        throw new AppError(409, 'REVIEW_CLAIM_REQUIRED', '请先认领该评估单元再复核');
      }
      const complianceStatus = input.complianceStatus as ComplianceStatus;
      if (!input.return && [ComplianceStatus.PARTIAL, ComplianceStatus.NON_COMPLIANT].includes(complianceStatus)) {
        await findingService.createForReview(item, input.finding, user, transaction);
      }
      await item.update(input.return ? {
        workflowStatus: EvaluationWorkflowStatus.RETURNED,
        complianceStatus: ComplianceStatus.NOT_ASSESSED,
        reviewedBy: user.userId,
        reviewedAt: new Date(),
        reviewClaimedBy: null,
        reviewClaimedAt: null,
        lockVersion: item.lockVersion + 1,
      } : {
        workflowStatus: EvaluationWorkflowStatus.REVIEWED,
        complianceStatus,
        reviewedBy: user.userId,
        reviewedAt: new Date(),
        lockVersion: item.lockVersion + 1,
      }, { transaction });
      const task = await AuditTask.findByPk(item.taskId, { transaction, lock: transaction.LOCK.UPDATE });
      if (task && input.return) {
        await task.update({ status: TaskStatus.IN_PROGRESS }, { transaction });
      } else if (task && !directFillingReview && task.status !== TaskStatus.PENDING_REVIEW) {
        await task.update({ status: TaskStatus.PENDING_REVIEW }, { transaction });
      }
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'control_evaluation',
        resourceId: id,
        operationDetails: `${input.return ? '退回' : '复核'}评估单元，自审=${item.assignedTo === user.userId}`,
        success: true,
        departmentId: item.responsibleDepartmentId,
      }, transaction);
    });
    const reviewedItem = await QuestionItem.findByPk(id, { attributes: ['id', 'taskId'] });
    if (reviewedItem) {
      const remaining = await QuestionItem.count({
        where: { taskId: reviewedItem.taskId, workflowStatus: { [Op.ne]: EvaluationWorkflowStatus.REVIEWED } },
      });
      if (remaining === 0) await taskLifecycleService.completeReview(reviewedItem.taskId, user.userId);
    }
    if (!input.return) await this.refreshFutureHistoryLinks(id);
    return this.detail(id, user);
  }

  async reopenReview(id: string, reason: string, expectedLockVersion: number, user: RequestUser) {
    const normalizedReason = String(reason || '').trim();
    if (!normalizedReason) throw new AppError(400, 'VALIDATION_ERROR', '请填写撤销复核原因');
    const canReopen = user.isGlobalAdmin
      || (user.permissions?.tasks?.includes('update') && user.permissionScopes?.tasks?.update === 'all');
    if (!canReopen) {
      throw new AppError(403, 'FORBIDDEN', '只有评估管理员可以撤销复核');
    }
    await objectAccessService.evaluationOrNotFound(id, user, 'read');
    await sequelize.transaction(async (transaction) => {
      const item = await QuestionItem.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!item) throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      assertLockVersion(item.lockVersion, expectedLockVersion);
      if (item.workflowStatus !== EvaluationWorkflowStatus.REVIEWED) {
        throw new AppError(409, 'CONFLICT', '只有已复核的评估单元可以撤销复核');
      }
      const task = await AuditTask.findByPk(item.taskId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!task) throw new AppError(404, 'NOT_FOUND', '评估项目不存在');
      if ([TaskStatus.CLOSED, TaskStatus.CANCELLED].includes(task.status)) {
        throw new AppError(409, 'CONFLICT', '已关闭或已取消的评估项目不能撤销复核');
      }

      const finding = await Finding.findOne({ where: { evaluationId: item.id }, transaction, lock: transaction.LOCK.UPDATE });
      const [riskSourceCount, actionLinkCount, riskFindingCount] = await Promise.all([
        RiskSource.count({ where: { controlEvaluationId: item.id }, transaction }),
        finding ? FindingActionLink.count({ where: { findingId: finding.id }, transaction }) : 0,
        finding ? RiskFindingLink.count({ where: { findingId: finding.id }, transaction }) : 0,
      ]);
      const findingHasProgressed = Boolean(finding
        && finding.status !== FindingStatus.CANCELLED
        && (finding.status !== FindingStatus.OPEN || finding.disposition !== FindingDisposition.PENDING));
      if (riskSourceCount > 0 || actionLinkCount > 0 || riskFindingCount > 0 || findingHasProgressed) {
        throw new AppError(409, 'DOWNSTREAM_EXISTS', '该评估项已进入整改或风险流程，请先处理下游关联');
      }

      const previousComplianceStatus = item.complianceStatus;
      if (finding?.status === FindingStatus.OPEN) {
        await finding.update({
          status: FindingStatus.CANCELLED,
          lockVersion: finding.lockVersion + 1,
        }, { transaction });
      }
      await item.update({
        workflowStatus: EvaluationWorkflowStatus.IN_PROGRESS,
        complianceStatus: ComplianceStatus.NOT_ASSESSED,
        reviewedBy: null,
        reviewedAt: null,
        submittedAt: null,
        reviewClaimedBy: null,
        reviewClaimedAt: null,
        lockVersion: item.lockVersion + 1,
      }, { transaction });
      await task.update({
        status: TaskStatus.IN_PROGRESS,
        submittedAt: null,
        reviewedAt: null,
        lockVersion: task.lockVersion + 1,
      }, { transaction });
      await EvaluationHistoryLink.destroy({ where: { sourceEvaluationId: item.id }, transaction });
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'control_evaluation',
        resourceId: item.id,
        operationDetails: `撤销评估单元复核，原结论=${previousComplianceStatus}，原因=${normalizedReason}`,
        relatedResourceIds: finding ? { findingId: finding.id } : {},
        reasonCode: 'ADMIN_REOPEN_REVIEW',
        success: true,
        departmentId: item.responsibleDepartmentId,
      }, transaction);
    });
    return this.detail(id, user);
  }

  async claimReview(id: string, user: RequestUser) {
    await objectAccessService.evaluationOrNotFound(id, user, 'claim');
    await sequelize.transaction(async (transaction) => {
      const item = await QuestionItem.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!item) throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      if (item.assignedTo === user.userId && !this.canReviewOwnEvaluation(user)) {
        throw new AppError(403, 'SELF_REVIEW_FORBIDDEN', '填写人不能认领自己的评估单元');
      }
      const assigned = await AssessmentAuditor.findOne({
        where: { taskId: item.taskId, auditorUserId: user.userId },
        transaction,
      });
      const mayReviewOwnAssignment = item.assignedTo === user.userId && this.canReviewOwnEvaluation(user);
      if (!assigned && !mayReviewOwnAssignment && !this.canManageReviewPool(user)) {
        throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      }
      if (item.workflowStatus !== EvaluationWorkflowStatus.SUBMITTED) {
        throw new AppError(409, 'CONFLICT', '只有待复核的评估单元可以认领');
      }
      if (item.reviewClaimedBy && item.reviewClaimedBy !== user.userId) {
        throw new AppError(409, 'REVIEW_ALREADY_CLAIMED', '该评估单元已被其他审计员认领');
      }
      if (!item.reviewClaimedBy) {
        await item.update({
          reviewClaimedBy: user.userId,
          reviewClaimedAt: new Date(),
          lockVersion: item.lockVersion + 1,
        }, { transaction });
      }
    });
    return this.detail(id, user);
  }

  async releaseReview(id: string, user: RequestUser) {
    await objectAccessService.evaluationOrNotFound(id, user, 'claim');
    await sequelize.transaction(async (transaction) => {
      const item = await QuestionItem.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!item) throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      const canForce = user.isGlobalAdmin || user.permissionScopes?.tasks?.update === 'all';
      if (item.reviewClaimedBy && item.reviewClaimedBy !== user.userId && !canForce) {
        throw new AppError(403, 'FORBIDDEN', '只能释放自己认领的评估单元');
      }
      if (item.workflowStatus !== EvaluationWorkflowStatus.SUBMITTED) {
        throw new AppError(409, 'CONFLICT', '当前评估单元不能释放认领');
      }
      await item.update({
        reviewClaimedBy: null,
        reviewClaimedAt: null,
        lockVersion: item.lockVersion + 1,
      }, { transaction });
    });
    return this.detail(id, user);
  }

  async transferReview(id: string, auditorUserId: string, user: RequestUser) {
    if (!user.isGlobalAdmin && user.permissionScopes?.tasks?.update !== 'all') {
      throw new AppError(403, 'FORBIDDEN', '只有评估管理员可以强制转派');
    }
    await objectAccessService.evaluationOrNotFound(id, user, 'read');
    const targetContext = await memberContextService.resolve(auditorUserId);
    if (!targetContext) throw new AppError(404, 'NOT_FOUND', '目标复核人不存在或已停用');
    await sequelize.transaction(async (transaction) => {
      const item = await QuestionItem.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!item) throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      if (item.workflowStatus !== EvaluationWorkflowStatus.SUBMITTED) {
        throw new AppError(409, 'CONFLICT', '只有待复核单元可以转派');
      }
      if (item.assignedTo === auditorUserId) {
        throw new AppError(403, 'SELF_REVIEW_FORBIDDEN', '填写人不能复核自己的评估单元');
      }
      await lookupService.assertSelectable('auditors', 'review-transfer', [auditorUserId], user, item.taskId);
      const assigned = await AssessmentAuditor.findOne({
        where: { taskId: item.taskId, auditorUserId },
        transaction,
      });
      if (!assigned) throw new AppError(400, 'AUDITOR_NOT_ASSIGNED', '目标用户不在该项目审计员池中');
      await item.update({
        reviewClaimedBy: auditorUserId,
        reviewClaimedAt: new Date(),
        lockVersion: item.lockVersion + 1,
      }, { transaction });
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'control_evaluation',
        resourceId: item.id,
        operationDetails: `强制转派评估单元复核至 ${targetContext.member.displayName}`,
        relatedResourceIds: { auditorUserId },
        success: true,
        departmentId: item.responsibleDepartmentId,
      }, transaction);
    });
    return this.detail(id, user);
  }
}

export default new EvaluationService();
