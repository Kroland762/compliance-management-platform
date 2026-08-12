import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  AssessmentAsset,
  AssessmentAuditor,
  EvaluationWorkflowStatus,
  QuestionItem,
  RemediationAction,
} from '../src/models';
import workItemService from '../src/services/work-item.service';

const auditor = {
  userId: 'auditor-1',
  permissions: { evaluations: ['read', 'claim', 'review'] },
  permissionScopes: { evaluations: { review: 'assigned' } },
} as any;

describe('work item review visibility', () => {
  afterEach(() => vi.restoreAllMocks());

  test('includes submitted rows filled by the same review-capable auditor', async () => {
    const item: any = {
      id: 'evaluation-1',
      taskId: 'task-1',
      assignedTo: auditor.userId,
      workflowStatus: EvaluationWorkflowStatus.SUBMITTED,
      evaluationAssets: [],
      toJSON: () => ({
        id: 'evaluation-1',
        taskId: 'task-1',
        assignedTo: auditor.userId,
        workflowStatus: EvaluationWorkflowStatus.SUBMITTED,
        evaluationAssets: [],
      }),
    };
    vi.spyOn(AssessmentAuditor, 'findAll').mockResolvedValue([{ taskId: 'task-1' }] as any);
    const findEvaluations = vi.spyOn(QuestionItem, 'findAll')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([item]);
    vi.spyOn(RemediationAction, 'findAll').mockResolvedValue([]);
    vi.spyOn(AssessmentAsset, 'findAll').mockResolvedValue([]);

    const result = await workItemService.list(auditor);

    expect(result.counts.review).toBe(1);
    expect(result.review[0]).toMatchObject({ id: item.id, assignedTo: auditor.userId });
    expect(findEvaluations.mock.calls[1][0]).toEqual(expect.objectContaining({
      where: expect.not.objectContaining({ assignedTo: expect.anything() }),
    }));
  });
});
