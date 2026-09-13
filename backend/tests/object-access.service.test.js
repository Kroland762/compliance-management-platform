import { afterEach, describe, expect, test, vi } from 'vitest';
import { Op } from 'sequelize';
import objectAccessService from '../src/services/object-access.service';
import { AssessmentAuditor, AuditTask, Department, EvaluationHistoryLink, Finding, FindingActionLink, RemediationAction, RiskActionLink, QuestionItem, RiskRecord, VerificationStatus } from '../src/models';
import findingService from '../src/services/finding.service';
import sequelize from '../src/config/database';
import riskDomainService from '../src/services/risk-domain.service';
import auditLogService from '../src/services/audit-log.service';

const actor = (overrides = {}) => ({
  userId: 'user-1',
  username: 'user-1',
  role: 'respondent',
  roleIds: [],
  tenantId: 'tenant-1',
  permissions: { tasks: ['read', 'update'] },
  permissionScopes: { tasks: { read: 'self', update: 'self' } },
  departmentIds: [],
  isGlobalAdmin: false,
  tokenKind: 'tenant',
  ...overrides,
});

describe('object access service', () => {
  afterEach(() => vi.restoreAllMocks());

  const mockNoAuditorAssignments = () => vi.spyOn(AssessmentAuditor, 'findAll').mockResolvedValue([]);

  test.each(['verify', 'remediate', 'escalate'])('finding %s uses its department scope even when read covers all', async (action) => {
    const user = actor({ departmentIds: ['dept-1'], permissionScopes: { findings: { read: 'all', [action]: 'department' } } });
    const rows = [{ id: 'local', ownerDepartmentId: 'dept-1' }, { id: 'remote', ownerDepartmentId: 'dept-2' }];
    vi.spyOn(Finding, 'findOne').mockImplementation(async ({ where }) => rows.find(row => row.id === where.id
      && (!where.ownerDepartmentId || where.ownerDepartmentId[Op.in].includes(row.ownerDepartmentId))) || null);
    await expect(objectAccessService.findingOrNotFound('remote', user)).resolves.toMatchObject({ id: 'remote' });
    await expect(objectAccessService.findingOrNotFound('local', user, action)).resolves.toMatchObject({ id: 'local' });
    await expect(objectAccessService.findingOrNotFound('remote', user, action)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('finding verification stops before any write for a readable but out-of-scope finding', async () => {
    const user = actor({ departmentIds: ['dept-1'], permissionScopes: { findings: { read: 'all', verify: 'department' } } });
    vi.spyOn(Finding, 'findOne').mockResolvedValue(null);
    const transaction = vi.spyOn(sequelize, 'transaction');
    await expect(findingService.verifyAction('remote', 'action', { decision: VerificationStatus.APPROVED }, user, 1))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(Finding.findOne).toHaveBeenCalledWith({ where: { id: 'remote', ownerDepartmentId: { [Op.in]: ['dept-1'] } } });
    expect(transaction).not.toHaveBeenCalled();
  });

  test('finding remediation and escalation enforce the action scope before changing disposition', async () => {
    const access = vi.spyOn(objectAccessService, 'findingOrNotFound').mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
    const user = actor();
    await expect(findingService.remediate('finding', {}, user, 1)).rejects.toMatchObject({ statusCode: 404 });
    expect(access).toHaveBeenLastCalledWith('finding', user, 'remediate');
    await expect(riskDomainService.createFromFindings({ title: 'risk', description: 'description', riskLevel: 'high', findingIds: ['finding'] }, user))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(access).toHaveBeenLastCalledWith('finding', user, 'escalate');
  });

  test.each([false, true])('in-scope finding verification preserves the self-review guard (self=%s)', async (self) => {
    const user = actor({ departmentIds: ['dept-1'], permissionScopes: { findings: { read: 'all', verify: 'department' } } });
    const finding = { id: 'finding', ownerDepartmentId: 'dept-1', lockVersion: 1, update: vi.fn() };
    const action = { ownerUserId: self ? user.userId : 'other-owner', status: 'pending_verification', lockVersion: 1, update: vi.fn() };
    const link = { update: vi.fn() };
    vi.spyOn(Finding, 'findOne').mockResolvedValue(finding);
    vi.spyOn(Finding, 'findByPk').mockResolvedValue(finding);
    vi.spyOn(RemediationAction, 'findByPk').mockResolvedValue(action);
    vi.spyOn(FindingActionLink, 'findOne').mockResolvedValue(link);
    vi.spyOn(FindingActionLink, 'count').mockResolvedValue(0);
    vi.spyOn(RiskActionLink, 'count').mockResolvedValue(0);
    vi.spyOn(sequelize, 'transaction').mockImplementation(async callback => callback({ LOCK: { UPDATE: 'UPDATE' } }));
    vi.spyOn(auditLogService, 'log').mockResolvedValue(undefined);
    vi.spyOn(findingService, 'detail').mockResolvedValue(finding);
    const result = findingService.verifyAction('finding', 'action', { decision: VerificationStatus.APPROVED }, user, 1);
    if (self) {
      await expect(result).rejects.toMatchObject({ code: 'SELF_REVIEW_FORBIDDEN' });
      expect(link.update).not.toHaveBeenCalled();
    } else {
      await expect(result).resolves.toBe(finding);
      expect(link.update).toHaveBeenCalledWith(expect.objectContaining({ verificationStatus: 'approved', verifiedBy: user.userId }), expect.any(Object));
      expect(finding.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'resolved', lockVersion: 2 }), expect.any(Object));
    }
  });

  test('finding verification all, department tree and self scopes stay independent of read', async () => {
    await expect(objectAccessService.findingScope(actor({ permissionScopes: { findings: { read: 'self', verify: 'all' } } }), 'verify')).resolves.toEqual({});
    vi.spyOn(Department, 'findAll').mockResolvedValueOnce([{ id: 'child' }]).mockResolvedValueOnce([]);
    const tree = await objectAccessService.findingScope(actor({ departmentIds: ['parent'], permissionScopes: { findings: { read: 'all', verify: 'department_tree' } } }), 'verify');
    expect(tree.ownerDepartmentId[Op.in]).toEqual(['parent', 'child']);
    await expect(objectAccessService.findingScope(actor({ permissionScopes: { tasks: { read: 'all' }, findings: { read: 'all', verify: 'self' } } }), 'verify'))
      .resolves.toEqual({ ownerUserId: 'user-1' });
  });

  test('assigned finding verification includes actual task assignments without broad task read scope', async () => {
    mockNoAuditorAssignments();
    vi.spyOn(QuestionItem, 'findAll').mockResolvedValue([]);
    const tasks = vi.spyOn(AuditTask, 'findAll').mockResolvedValue([{ id: 'assigned-task' }]);
    const scope = await objectAccessService.findingScope(actor({ permissionScopes: { tasks: { read: 'all' }, findings: { read: 'all', verify: 'assigned' } } }), 'verify');
    expect(tasks.mock.calls[0][0].where[Op.or]).toEqual(expect.arrayContaining([{ assignedTo: 'user-1' }, { reviewerId: 'user-1' }]));
    expect(scope[Op.or]).toEqual([{ ownerUserId: 'user-1' }, { taskId: { [Op.in]: ['assigned-task'] } }]);
  });

  test('global administrators can access every task object', async () => {
    vi.spyOn(AuditTask, 'findOne').mockResolvedValue({ id: 'task-1' });
    await expect(objectAccessService.taskOrNotFound(
      'task-1',
      actor({ isGlobalAdmin: true }),
      'delete',
    )).resolves.toMatchObject({ id: 'task-1' });
    expect(AuditTask.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'task-1' } }));
  });

  test('assigned respondents receive an object-scoped task query', async () => {
    mockNoAuditorAssignments();
    vi.spyOn(QuestionItem, 'findAll').mockResolvedValue([{ taskId: 'task-1' }]);
    vi.spyOn(AuditTask, 'findOne').mockResolvedValue({ id: 'task-1' });
    await expect(objectAccessService.taskOrNotFound('task-1', actor(), 'read'))
      .resolves.toMatchObject({ id: 'task-1' });
    expect(AuditTask.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'task-1' }),
    }));
  });

  test('unrelated users receive not-found semantics without object disclosure', async () => {
    mockNoAuditorAssignments();
    vi.spyOn(QuestionItem, 'findAll').mockResolvedValue([]);
    vi.spyOn(AuditTask, 'findOne').mockResolvedValue(null);
    await expect(objectAccessService.taskOrNotFound('task-1', actor(), 'read'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
  });

  test('question access delegates to the evaluation scope', async () => {
    vi.spyOn(QuestionItem, 'findOne').mockResolvedValue({ id: 'question-1' });
    await expect(objectAccessService.questionOrNotFound('question-1', actor(), true))
      .resolves.toMatchObject({ id: 'question-1' });
  });

  test('historical source evidence is readable only through an accessible explicit history link', async () => {
    const access = vi.spyOn(objectAccessService, 'evaluationOrNotFound');
    access.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'NOT_FOUND' }));
    access.mockResolvedValueOnce({ id: 'current-1' });
    vi.spyOn(EvaluationHistoryLink, 'findAll').mockResolvedValue([{ currentEvaluationId: 'current-1' }]);
    vi.spyOn(QuestionItem, 'findByPk').mockResolvedValue({ id: 'source-1' });
    await expect(objectAccessService.questionOrHistorySourceNotFound('source-1', actor()))
      .resolves.toMatchObject({ id: 'source-1' });
    expect(access).toHaveBeenNthCalledWith(2, 'current-1', expect.any(Object), 'read');
  });

  test('assigned risk scope includes creator, owner and independent reviewer', async () => {
    mockNoAuditorAssignments();
    vi.spyOn(QuestionItem, 'findAll').mockResolvedValue([]);
    vi.spyOn(AuditTask, 'findAll').mockResolvedValue([]);
    const find = vi.spyOn(RiskRecord, 'findOne').mockResolvedValue({ id: 'risk-1' });
    const riskActor = actor({
      permissions: { risks: ['read'] },
      permissionScopes: { risks: { read: 'assigned' } },
    });

    await objectAccessService.riskOrNotFound('risk-1', riskActor);

    const clauses = find.mock.calls[0][0].where[Op.or];
    expect(clauses).toEqual(expect.arrayContaining([
      { ownerUserId: riskActor.userId },
      { createdBy: riskActor.userId },
      { reviewerUserId: riskActor.userId },
    ]));
  });

  test('risk scopes preserve all, department and self boundaries', async () => {
    await expect(objectAccessService.riskScope(actor({
      permissions: { risks: ['read'] },
      permissionScopes: { risks: { read: 'all' } },
    }))).resolves.toEqual({});

    const departmentScope = await objectAccessService.riskScope(actor({
      permissions: { risks: ['read'] }, departmentIds: ['dept-1', 'dept-2'],
      permissionScopes: { risks: { read: 'department' } },
    }));
    expect(departmentScope.ownerDepartmentId[Op.in]).toEqual(['dept-1', 'dept-2']);

    const riskActor = actor({ permissions: { risks: ['read'] }, permissionScopes: { risks: { read: 'self' } } });
    const selfScope = await objectAccessService.riskScope(riskActor);
    expect(selfScope[Op.or]).toEqual([
      { ownerUserId: riskActor.userId },
      { createdBy: riskActor.userId },
      { reviewerUserId: riskActor.userId },
    ]);
  });

  test('an unrelated user receives not-found semantics for a risk', async () => {
    vi.spyOn(RiskRecord, 'findOne').mockResolvedValue(null);
    const riskActor = actor({ permissions: { risks: ['read'] }, permissionScopes: { risks: { read: 'self' } } });
    await expect(objectAccessService.riskOrNotFound('risk-hidden', riskActor))
      .rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
  });
});
