import { Op, type WhereOptions } from 'sequelize';
import {
  Asset,
  AssessmentAuditor,
  Department,
  DepartmentMember,
  MemberRole,
  ProductDossierQuestionnaire,
  ProductQuestionnaireTemplate,
  ProductType,
  QuestionnaireTemplate,
  RiskLifecycleStatus,
  RiskRecord,
  Role,
  TenantMember,
  TenantMemberStatus,
  User,
  type DataScope,
  type PermissionAction,
  type PermissionResource,
} from '../models';
import { AppError } from '../utils/http';
import objectAccessService from './object-access.service';
import riskReviewerEligibility from './risk-reviewer-eligibility.service';

type RequestUser = NonNullable<Express.Request['user']>;

export const LOOKUP_KINDS = [
  'departments', 'personnel', 'auditors', 'roles', 'assets', 'risks',
  'assessment-templates', 'product-questionnaires', 'product-types',
  'account-data-sources', 'account-rules',
] as const;
export type LookupKind = typeof LOOKUP_KINDS[number];

type PurposeRule = {
  kinds: LookupKind[];
  checks: Array<[PermissionResource, PermissionAction]>;
};

const PURPOSES: Record<string, PurposeRule> = {
  'asset-owner': { kinds: ['departments', 'personnel'], checks: [['assets', 'create'], ['assets', 'update']] },
  'finding-remediation-owner': { kinds: ['departments', 'personnel'], checks: [['findings', 'remediate']] },
  'finding-escalation-owner': { kinds: ['departments', 'personnel'], checks: [['findings', 'escalate']] },
  'risk-owner': { kinds: ['departments', 'personnel'], checks: [['risks', 'create'], ['risks', 'update']] },
  'risk-filter': { kinds: ['departments'], checks: [['risks', 'read']] },
  'risk-reviewer': { kinds: ['personnel'], checks: [['risks', 'create'], ['risks', 'assign']] },
  'risk-assets': { kinds: ['assets'], checks: [['risks', 'create'], ['risks', 'update']] },
  'remediation-owner': { kinds: ['departments', 'personnel'], checks: [['remediation_actions', 'create'], ['remediation_actions', 'update']] },
  'qualification-owner': { kinds: ['departments', 'personnel'], checks: [['qualifications', 'create'], ['qualifications', 'update']] },
  'product-owner': { kinds: ['departments', 'personnel', 'product-types'], checks: [['products', 'create'], ['products', 'update']] },
  'product-filter': { kinds: ['product-types'], checks: [['products', 'read']] },
  'assessment-owner': { kinds: ['departments', 'personnel', 'auditors', 'assessment-templates'], checks: [['tasks', 'create'], ['tasks', 'update']] },
  'review-transfer': { kinds: ['auditors'], checks: [['evaluations', 'review']] },
  'organization-parent': { kinds: ['departments'], checks: [['organization', 'create'], ['organization', 'update']] },
  'organization-manager': { kinds: ['personnel'], checks: [['organization', 'create'], ['organization', 'update']] },
  'user-membership': { kinds: ['departments', 'roles'], checks: [['users', 'create'], ['users', 'update']] },
  'evaluation-assignment': { kinds: ['personnel', 'assets'], checks: [['tasks', 'create'], ['tasks', 'update'], ['evaluations', 'answer'], ['evaluations', 'review']] },
  'remediation-risk': { kinds: ['risks'], checks: [['remediation_actions', 'create'], ['remediation_actions', 'update'], ['remediation_actions', 'link']] },
  'product-questionnaire': { kinds: ['product-questionnaires'], checks: [['product_dossiers', 'update'], ['product_compliance_config', 'read']] },
  'account-task-source': { kinds: ['account-data-sources'], checks: [['account_tasks', 'create'], ['account_tasks', 'update']] },
  'account-task-rules': { kinds: ['account-rules'], checks: [['account_tasks', 'create'], ['account_tasks', 'update']] },
};

export interface LookupOption {
  value: string;
  label: string;
  disabled: boolean;
  meta?: Record<string, unknown>;
}

export interface LookupQuery {
  purpose?: unknown;
  q?: unknown;
  page?: unknown;
  pageSize?: unknown;
  selectedIds?: unknown;
  contextId?: unknown;
}

function hasPermission(user: RequestUser, resource: PermissionResource, action: PermissionAction): boolean {
  return Boolean(user.permissions?.[resource]?.includes(action));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function parseQuery(kindValue: string, query: LookupQuery) {
  if (!LOOKUP_KINDS.includes(kindValue as LookupKind)) throw new AppError(404, 'NOT_FOUND', '选择器资源不存在');
  const kind = kindValue as LookupKind;
  const purpose = String(query.purpose || '').trim();
  const rule = PURPOSES[purpose];
  if (!rule || !rule.kinds.includes(kind)) throw new AppError(400, 'VALIDATION_ERROR', 'purpose 与选择器资源不匹配');
  const q = String(query.q || '').trim();
  if (q.length > 100) throw new AppError(400, 'VALIDATION_ERROR', 'q 最长 100 个字符');
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  if (!Number.isInteger(page) || page < 1) throw new AppError(400, 'VALIDATION_ERROR', 'page 必须是正整数');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new AppError(400, 'VALIDATION_ERROR', 'pageSize 必须是 1 到 50 的整数');
  const rawSelected = Array.isArray(query.selectedIds)
    ? query.selectedIds
    : String(query.selectedIds || '').split(',').filter(Boolean);
  const selectedIds = [...new Set(rawSelected.map((value) => String(value).trim()).filter(Boolean))];
  if (selectedIds.length > 50) throw new AppError(400, 'VALIDATION_ERROR', 'selectedIds 最多 50 个');
  if (selectedIds.some((id) => !UUID_PATTERN.test(id))) {
    throw new AppError(400, 'VALIDATION_ERROR', 'selectedIds 必须是 UUID');
  }
  const contextId = String(query.contextId || '').trim();
  if (contextId && !UUID_PATTERN.test(contextId)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'contextId 必须是 UUID');
  }
  return { kind, purpose, rule, q, pattern: `%${escapeLike(q)}%`, page, pageSize, selectedIds, contextId };
}

function response(items: LookupOption[], selectedItems: LookupOption[], page: number, pageSize: number, total: number) {
  const itemIds = new Set(items.map((item) => item.value));
  return {
    items,
    selectedItems: selectedItems.filter((item) => !itemIds.has(item.value)),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize), hasMore: page * pageSize < total },
  };
}

class LookupService {
  private async departmentTreeIds(seedIds: string[]): Promise<string[]> {
    const ids = new Set(seedIds);
    let frontier = [...seedIds];
    while (frontier.length) {
      const children = await Department.findAll({ where: { parentId: { [Op.in]: frontier } }, attributes: ['id'] });
      frontier = children.map((item) => item.id).filter((id) => !ids.has(id));
      frontier.forEach((id) => ids.add(id));
    }
    return [...ids];
  }

  private winningCheck(user: RequestUser, checks: PurposeRule['checks'], contextId = ''): [PermissionResource, PermissionAction] {
    const permitted = checks.filter(([resource, action]) => hasPermission(user, resource, action));
    const preferredAction = contextId ? 'update' : 'create';
    const check = permitted.find(([, action]) => action === preferredAction) || permitted[0];
    if (!check) throw new AppError(403, 'FORBIDDEN', '无权加载该选择器');
    return check;
  }

  private async validateContext(input: ReturnType<typeof parseQuery>, user: RequestUser): Promise<void> {
    if (!input.contextId) return;
    if (input.purpose === 'asset-owner') { await objectAccessService.assetOrNotFound(input.contextId, user, 'update'); return; }
    if (input.purpose === 'risk-reviewer' || input.purpose === 'risk-assets') {
      await objectAccessService.riskOrNotFound(input.contextId, user, input.purpose === 'risk-reviewer' ? 'assign' : 'update');
      return;
    }
    if (input.purpose === 'finding-remediation-owner') { await objectAccessService.findingOrNotFound(input.contextId, user); return; }
    if (input.purpose === 'qualification-owner') { await objectAccessService.qualificationOrNotFound(input.contextId, user, 'update'); return; }
    if (input.purpose === 'product-owner') { await objectAccessService.productOrNotFound(input.contextId, user, 'update'); return; }
    if (input.purpose === 'remediation-owner' || input.purpose === 'remediation-risk') {
      await objectAccessService.remediationOrNotFound(input.contextId, user, 'update');
      return;
    }
    if (input.purpose === 'assessment-owner' || input.purpose === 'review-transfer') {
      await objectAccessService.taskOrNotFound(input.contextId, user, input.purpose === 'assessment-owner' ? 'update' : 'read');
      return;
    }
    if (input.purpose === 'evaluation-assignment') {
      const evaluation = await objectAccessService.evaluationOrNotFound(input.contextId, user, 'read');
      await objectAccessService.taskOrNotFound(evaluation.taskId, user, 'update');
      return;
    }
    if (input.purpose === 'product-questionnaire') { await objectAccessService.dossierOrNotFound(input.contextId, user, 'update'); return; }
    if (input.purpose === 'organization-parent' || input.purpose === 'organization-manager') {
      const allowed = await this.candidateDepartmentIds(user, input.rule, input.contextId);
      if (allowed !== null && !allowed.includes(input.contextId)) throw new AppError(404, 'NOT_FOUND', '上下文记录不存在或超出数据权限');
      if (!await Department.findByPk(input.contextId)) throw new AppError(404, 'NOT_FOUND', '上下文记录不存在或超出数据权限');
      return;
    }
    if (input.purpose === 'user-membership') {
      const allowed = await this.allowedMemberIds(user, input.rule, input.contextId);
      if (allowed !== null && !allowed.includes(input.contextId)) throw new AppError(404, 'NOT_FOUND', '上下文记录不存在或超出数据权限');
      if (!await TenantMember.findByPk(input.contextId)) throw new AppError(404, 'NOT_FOUND', '上下文记录不存在或超出数据权限');
      return;
    }
    if (input.purpose === 'account-task-source' || input.purpose === 'account-task-rules') {
      const AccountAuditTask = (await import('../models/account/AuditTask')).default;
      if (!await AccountAuditTask.findByPk(input.contextId)) throw new AppError(404, 'NOT_FOUND', '上下文记录不存在或超出数据权限');
    }
  }

  private async candidateDepartmentIds(user: RequestUser, rule: PurposeRule, contextId = ''): Promise<string[] | null> {
    const [resource, action] = this.winningCheck(user, rule.checks, contextId);
    const scope: DataScope = user.isGlobalAdmin ? 'all' : user.permissionScopes?.[resource]?.[action] || 'self';
    if (scope === 'all') return null;
    if (scope === 'department_tree') return this.departmentTreeIds(user.departmentIds || []);
    return user.departmentIds || [];
  }

  private async historicalOwners(input: ReturnType<typeof parseQuery>, user: RequestUser): Promise<{ departmentIds: string[]; userIds: string[]; memberIds: string[] }> {
    const result = { departmentIds: [] as string[], userIds: [] as string[], memberIds: [] as string[] };
    if (!input.contextId || !input.selectedIds.length) return result;
    let record: any;
    if (input.purpose === 'asset-owner') record = await objectAccessService.assetOrNotFound(input.contextId, user, 'update');
    if (input.purpose === 'finding-remediation-owner') record = await objectAccessService.findingOrNotFound(input.contextId, user);
    if (input.purpose === 'qualification-owner') record = await objectAccessService.qualificationOrNotFound(input.contextId, user, 'update');
    if (input.purpose === 'product-owner') record = await objectAccessService.productOrNotFound(input.contextId, user, 'update');
    if (input.purpose === 'remediation-owner') record = await objectAccessService.remediationOrNotFound(input.contextId, user, 'update');
    if (input.purpose === 'assessment-owner') record = await objectAccessService.taskOrNotFound(input.contextId, user, 'update');
    if (input.purpose === 'organization-parent' || input.purpose === 'organization-manager') record = await Department.findByPk(input.contextId);
    const departmentId = record?.ownerDepartmentId || record?.departmentId || record?.parentId;
    const userId = record?.ownerUserId || record?.responsibleUserId || record?.assignedTo;
    if (departmentId) result.departmentIds.push(String(departmentId));
    if (userId) result.userIds.push(String(userId));
    if (record?.managerMemberId) result.memberIds.push(String(record.managerMemberId));
    if (input.purpose === 'assessment-owner' && input.kind === 'auditors') {
      const assignments = await AssessmentAuditor.findAll({ where: { taskId: input.contextId }, attributes: ['auditorUserId'] });
      result.userIds.push(...assignments.map((item) => item.auditorUserId));
    }
    if (input.purpose === 'user-membership' && input.kind === 'departments') {
      const memberships = await DepartmentMember.findAll({ where: { memberId: input.contextId }, attributes: ['departmentId'] });
      result.departmentIds.push(...memberships.map((item) => item.departmentId));
    }
    return result;
  }

  private async departmentOptions(where: WhereOptions, disabled: boolean, forcedDisabled = new Set<string>()): Promise<LookupOption[]> {
    const rows = await Department.findAll({ where, attributes: ['id', 'name', 'parentId', 'status'], order: [['name', 'ASC'], ['id', 'ASC']] });
    const all = await Department.findAll({ attributes: ['id', 'name', 'parentId'] });
    const byId = new Map(all.map((item) => [item.id, item]));
    const path = (row: Department) => {
      const names = [row.name];
      let parentId = row.parentId;
      const seen = new Set<string>();
      while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        const parent = byId.get(parentId);
        if (!parent) break;
        names.unshift(parent.name);
        parentId = parent.parentId;
      }
      return names.join(' / ');
    };
    return rows
      .map((row) => ({ value: row.id, label: path(row), disabled: disabled || forcedDisabled.has(row.id) || row.status !== 'active' }))
      .sort((left, right) => left.label.localeCompare(right.label, 'zh-Hans-CN') || left.value.localeCompare(right.value));
  }

  private async departments(input: ReturnType<typeof parseQuery>, user: RequestUser) {
    const allowed = await this.candidateDepartmentIds(user, input.rule, input.contextId);
    const base: any = { ...(allowed ? { id: { [Op.in]: allowed } } : {}) };
    const where = { ...base, status: 'active', ...(input.q ? { name: { [Op.iLike]: input.pattern } } : {}) };
    const { count, rows } = await Department.findAndCountAll({
      where,
      attributes: ['id', 'name', 'parentId', 'status'],
      order: [['name', 'ASC'], ['id', 'ASC']],
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    });
    const pageIds = rows.map((row) => row.id);
    const items = await this.departmentOptions({ id: { [Op.in]: pageIds } }, false);
    const historical = await this.historicalOwners(input, user);
    const selectedIds = allowed === null
      ? input.selectedIds
      : input.selectedIds.filter((id) => allowed.includes(id) || historical.departmentIds.includes(id));
    const forcedDisabled = new Set(allowed === null ? [] : selectedIds.filter((id) => !allowed.includes(id)));
    const selectedItems = input.selectedIds.length
      ? await this.departmentOptions({ id: { [Op.in]: selectedIds } }, false, forcedDisabled)
      : [];
    return response(items, selectedItems, input.page, input.pageSize, count);
  }

  private async allowedMemberIds(user: RequestUser, rule: PurposeRule, contextId = ''): Promise<string[] | null> {
    const [resource, action] = this.winningCheck(user, rule.checks, contextId);
    const scope: DataScope = user.isGlobalAdmin ? 'all' : user.permissionScopes?.[resource]?.[action] || 'self';
    if (scope === 'self' || scope === 'assigned') return user.memberId ? [user.memberId] : [];
    const allowedDepartments = await this.candidateDepartmentIds(user, rule, contextId);
    if (allowedDepartments === null) return null;
    if (!allowedDepartments.length) return user.memberId ? [user.memberId] : [];
    const links = await DepartmentMember.findAll({ where: { departmentId: { [Op.in]: allowedDepartments } }, attributes: ['memberId'] });
    const ids = new Set(links.map((link) => link.memberId));
    if (user.memberId) ids.add(user.memberId);
    return [...ids];
  }

  private async personnel(input: ReturnType<typeof parseQuery>, user: RequestUser, auditorsOnly = false, riskReviewersOnly = false) {
    let allowedMemberIds = await this.allowedMemberIds(user, input.rule, input.contextId);
    let assignedAuditorUserIds: string[] | null = null;
    if (auditorsOnly) {
      const roles = await Role.findAll({ attributes: ['id', 'permissions'] });
      const roleIds = roles.filter((role) => role.permissions?.evaluations?.includes('review')).map((role) => role.id);
      const links = roleIds.length ? await MemberRole.findAll({ where: { roleId: { [Op.in]: roleIds } }, attributes: ['memberId'] }) : [];
      const auditorIds = new Set(links.map((link) => link.memberId));
      allowedMemberIds = allowedMemberIds === null ? [...auditorIds] : allowedMemberIds.filter((id) => auditorIds.has(id));
      if (input.purpose === 'review-transfer') {
        if (!input.contextId) throw new AppError(400, 'VALIDATION_ERROR', '强制转派需要 contextId');
        await objectAccessService.taskOrNotFound(input.contextId, user, 'read');
        const assigned = await AssessmentAuditor.findAll({ where: { taskId: input.contextId }, attributes: ['auditorUserId'] });
        assignedAuditorUserIds = assigned.map((item) => item.auditorUserId);
      }
    }
    if (riskReviewersOnly) {
      // 审核人是风险的独立控制角色，创建人的风险数据范围不应把候选池缩成自己。
      allowedMemberIds = await riskReviewerEligibility.eligibleMemberIds();
    }
    const matchingUsers = input.q
      ? await User.findAll({ where: { username: { [Op.iLike]: input.pattern } }, attributes: ['id'] })
      : [];
    const base: any = { ...(allowedMemberIds !== null ? { id: { [Op.in]: allowedMemberIds } } : {}) };
    const where: any = {
      ...base,
      status: TenantMemberStatus.ACTIVE,
      ...(assignedAuditorUserIds !== null ? { userId: { [Op.in]: assignedAuditorUserIds } } : {}),
      ...(input.q ? { [Op.or]: [
        { displayName: { [Op.iLike]: input.pattern } },
        { userId: { [Op.in]: matchingUsers.map((item) => item.id) } },
      ] } : {}),
    };
    const { count, rows } = await TenantMember.findAndCountAll({
      where,
      attributes: ['id', 'userId', 'displayName', 'status'],
      order: [['displayName', 'ASC'], ['id', 'ASC']],
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    });
    const historical = await this.historicalOwners(input, user);
    const selectedIdentity = { [Op.or]: [{ id: { [Op.in]: input.selectedIds } }, { userId: { [Op.in]: input.selectedIds } }] };
    const selectedScope = allowedMemberIds === null
      ? {}
      : { [Op.or]: [
        { id: { [Op.in]: allowedMemberIds } },
        { id: { [Op.in]: historical.memberIds } },
        { userId: { [Op.in]: historical.userIds } },
      ] };
    const selected = input.selectedIds.length
      ? await TenantMember.findAll({ where: { [Op.and]: [selectedScope, selectedIdentity], ...(assignedAuditorUserIds !== null ? { userId: { [Op.in]: assignedAuditorUserIds } } : {}) }, attributes: ['id', 'userId', 'displayName', 'status'] })
      : [];
    const all = [...rows, ...selected];
    const users = all.length ? await User.findAll({ where: { id: { [Op.in]: all.map((row) => row.userId) } }, attributes: ['id', 'username'] }) : [];
    const usernames = new Map(users.map((item) => [item.id, item.username]));
    const map = (row: TenantMember, forceDisabled = false): LookupOption => ({
      value: row.userId,
      label: row.displayName,
      disabled: forceDisabled || row.status !== TenantMemberStatus.ACTIVE,
      meta: { memberId: row.id, userId: row.userId, username: usernames.get(row.userId) || null },
    });
    return response(
      rows.map((row) => map(row)),
      selected.map((row) => map(row, allowedMemberIds !== null && !allowedMemberIds.includes(row.id))),
      input.page,
      input.pageSize,
      count,
    );
  }

  private async simpleModel(input: ReturnType<typeof parseQuery>, user: RequestUser) {
    const common = { limit: input.pageSize, offset: (input.page - 1) * input.pageSize };
    let model: any;
    let base: any = {};
    let selectedBase: any = {};
    let field = 'name';
    let meta: (row: any) => Record<string, unknown> | undefined = () => undefined;
    let disabled: (row: any) => boolean = () => false;
    if (input.kind === 'roles') model = Role;
    if (input.kind === 'assets') {
      selectedBase = input.purpose === 'risk-assets' ? {} : await objectAccessService.assetScope(user, 'read');
      model = Asset;
      base = { status: 'active', ...selectedBase };
      meta = (row) => ({ code: row.code });
      disabled = (row) => row.status !== 'active';
    }
    if (input.kind === 'risks') {
      selectedBase = await objectAccessService.riskScope(user, 'read');
      model = RiskRecord;
      field = 'title';
      const linkable = [RiskLifecycleStatus.OPEN, RiskLifecycleStatus.REMEDIATING, RiskLifecycleStatus.PENDING_VERIFICATION, RiskLifecycleStatus.ACCEPTED];
      base = { status: { [Op.in]: linkable }, ...selectedBase };
      meta = (row) => ({ code: row.code });
      disabled = (row) => !linkable.includes(row.status);
    }
    if (input.kind === 'assessment-templates') { model = QuestionnaireTemplate; meta = (row) => ({ version: row.version }); }
    if (input.kind === 'product-questionnaires') { model = ProductQuestionnaireTemplate; base = { status: 'active' }; meta = (row) => ({ version: row.version }); disabled = (row) => row.status !== 'active'; }
    if (input.kind === 'product-types') { model = ProductType; base = { status: 'active' }; disabled = (row) => row.status !== 'active'; }
    if (input.kind === 'account-data-sources') {
      model = (await import('../models/account/DataSource')).default;
      base = { status: 'ACTIVE' };
      meta = (row) => ({ sourceType: row.sourceType, status: row.status });
      disabled = (row) => row.status !== 'ACTIVE';
    }
    if (input.kind === 'account-rules') {
      model = (await import('../models/account/AuditRule')).default;
      base = { isActive: true };
      meta = (row) => ({ severity: row.severity, ruleType: row.ruleType });
      disabled = (row) => !row.isActive;
    }
    if (!model) throw new AppError(404, 'NOT_FOUND', '选择器资源不存在');
    let selectedIds = input.selectedIds;
    if (input.contextId && input.kind === 'product-questionnaires') {
      const links = await ProductDossierQuestionnaire.findAll({ where: { dossierId: input.contextId }, attributes: ['templateId'] });
      const linkedIds = new Set(links.map((link) => link.templateId));
      selectedIds = selectedIds.filter((id) => linkedIds.has(id));
    }
    if (input.contextId && (input.kind === 'account-data-sources' || input.kind === 'account-rules')) {
      const AccountAuditTask = (await import('../models/account/AuditTask')).default;
      const task = await AccountAuditTask.findByPk(input.contextId, { attributes: ['sourceId', 'selectedRules'] });
      const linkedIds = new Set(input.kind === 'account-data-sources' ? [task?.sourceId].filter(Boolean) : task?.selectedRules || []);
      selectedIds = selectedIds.filter((id) => linkedIds.has(id));
    }
    const where = { ...base, ...(input.q ? { [field]: { [Op.iLike]: input.pattern } } : {}) };
    const { count, rows } = await model.findAndCountAll({ where, ...common, order: [[field, 'ASC'], ['id', 'ASC']] });
    const selectedRows = selectedIds.length ? await model.findAll({ where: { ...selectedBase, id: { [Op.in]: selectedIds } } }) : [];
    const map = (row: any): LookupOption => ({
      value: row.id,
      label: String(row[field]),
      disabled: disabled(row),
      ...(meta(row) ? { meta: meta(row) } : {}),
    });
    return response(rows.map(map), selectedRows.map(map), input.page, input.pageSize, count);
  }

  async list(kindValue: string, query: LookupQuery, user: RequestUser) {
    const input = parseQuery(kindValue, query);
    this.winningCheck(user, input.rule.checks, input.contextId);
    await this.validateContext(input, user);
    if (input.kind === 'departments') return this.departments(input, user);
    if (input.kind === 'personnel') return this.personnel(input, user, false, input.purpose === 'risk-reviewer');
    if (input.kind === 'auditors') return this.personnel(input, user, true);
    return this.simpleModel(input, user);
  }

  async assertOwners(purpose: string, departmentId: string | null | undefined, userId: string | null | undefined, user: RequestUser, contextId = '') {
    const rule = PURPOSES[purpose];
    if (!rule || !rule.kinds.includes('departments') || !rule.kinds.includes('personnel')) {
      throw new AppError(500, 'LOOKUP_PURPOSE_INVALID', '负责人资格规则未配置');
    }
    this.winningCheck(user, rule.checks, contextId);
    if (departmentId) {
      const allowed = await this.candidateDepartmentIds(user, rule, contextId);
      const department = await Department.findOne({ where: { id: departmentId, status: 'active', ...(allowed ? { id: { [Op.in]: allowed } } : {}) } });
      if (!department) throw new AppError(404, 'NOT_FOUND', '责任部门不存在或超出数据权限');
    }
    if (userId) {
      const allowed = await this.allowedMemberIds(user, rule, contextId);
      const member = await TenantMember.findOne({ where: { userId, status: TenantMemberStatus.ACTIVE, ...(allowed !== null ? { id: { [Op.in]: allowed } } : {}) } });
      if (!member) throw new AppError(404, 'NOT_FOUND', '负责人不存在或超出数据权限');
    }
  }

  async assertSelectable(kind: LookupKind, purpose: string, ids: string[], user: RequestUser, contextId = '') {
    if (!ids.length) return;
    const result = await this.list(kind, { purpose, page: 1, pageSize: 1, selectedIds: ids, contextId }, user);
    const found = new Set<string>();
    [...result.items, ...result.selectedItems].filter((item) => !item.disabled).forEach((item) => {
      found.add(item.value);
      if (kind === 'personnel' && item.meta?.memberId) found.add(String(item.meta.memberId));
    });
    if (ids.some((id) => !found.has(id))) throw new AppError(404, 'NOT_FOUND', '所选记录不存在、已停用或超出数据权限');
  }
}

export default new LookupService();
