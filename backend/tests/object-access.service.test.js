import { afterEach, describe, expect, test, vi } from 'vitest';
import objectAccessService from '../src/services/object-access.service';
import { AuditTask, QuestionItem } from '../src/models';

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
    vi.spyOn(QuestionItem, 'findAll').mockResolvedValue([{ taskId: 'task-1' }]);
    vi.spyOn(AuditTask, 'findOne').mockResolvedValue({ id: 'task-1' });
    await expect(objectAccessService.taskOrNotFound('task-1', actor(), 'read'))
      .resolves.toMatchObject({ id: 'task-1' });
    expect(AuditTask.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'task-1' }),
    }));
  });

  test('unrelated users receive not-found semantics without object disclosure', async () => {
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
});
