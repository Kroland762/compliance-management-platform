import { afterEach, describe, expect, test, vi } from 'vitest';
import { Op } from 'sequelize';
import objectAccessService from '../src/services/object-access.service';
import { AssessmentAuditor, AuditTask, EvaluationHistoryLink, QuestionItem, RiskRecord } from '../src/models';

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
