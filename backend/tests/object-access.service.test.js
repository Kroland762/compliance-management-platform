import { afterEach, describe, expect, test, vi } from 'vitest';
import objectAccessService, { ObjectAccessError } from '../src/services/object-access.service';
import { AuditTask, EvidenceFile, QuestionItem } from '../src/models';

const actor = (overrides = {}) => ({
  userId: 'user-1',
  tenantId: 'tenant-1',
  permissions: { tasks: ['read', 'update'] },
  ...overrides,
});

describe('object access service', () => {
  afterEach(() => vi.restoreAllMocks());

  test('tenant administrator with delete scope can access every task object', async () => {
    vi.spyOn(AuditTask, 'findByPk').mockResolvedValue({
      id: 'task-1', createdBy: 'other', reviewerId: 'other', assignedTo: 'other',
    });

    await expect(objectAccessService.assertTaskAccess(
      'task-1', actor({ permissions: { tasks: ['read', 'delete'] } }), 'delete',
    )).resolves.toMatchObject({ id: 'task-1' });
    expect(QuestionItem.count).not.toHaveBeenCalled;
  });

  test('respondent can only access tasks and questions assigned to them', async () => {
    vi.spyOn(AuditTask, 'findByPk').mockResolvedValue({
      id: 'task-1', createdBy: 'auditor', reviewerId: 'reviewer', assignedTo: null,
    });
    vi.spyOn(QuestionItem, 'count').mockResolvedValue(1);
    vi.spyOn(QuestionItem, 'findByPk').mockResolvedValue({ id: 'question-1', taskId: 'task-1', assignedTo: 'user-1' });

    await expect(objectAccessService.assertTaskAccess('task-1', actor(), 'read')).resolves.toBeTruthy();
    await expect(objectAccessService.assertQuestionAccess('question-1', actor(), 'respond')).resolves.toBeTruthy();
  });

  test('unrelated user is denied without leaking another object', async () => {
    vi.spyOn(AuditTask, 'findByPk').mockResolvedValue({
      id: 'task-1', createdBy: 'auditor', reviewerId: 'reviewer', assignedTo: null,
    });
    vi.spyOn(QuestionItem, 'count').mockResolvedValue(0);

    await expect(objectAccessService.assertTaskAccess('task-1', actor(), 'read'))
      .rejects.toMatchObject({ code: 'OBJECT_FORBIDDEN', statusCode: 403 });
  });

  test('evidence access is inherited from its question and task', async () => {
    vi.spyOn(EvidenceFile, 'findByPk').mockResolvedValue({ id: 'evidence-1', questionItemId: 'question-1' });
    vi.spyOn(QuestionItem, 'findByPk').mockResolvedValue({ id: 'question-1', taskId: 'task-1', assignedTo: 'user-1' });

    await expect(objectAccessService.assertEvidenceAccess('evidence-1', actor(), 'read'))
      .resolves.toMatchObject({ id: 'evidence-1' });
  });
});
