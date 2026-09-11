import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  AssessmentAsset,
  AssessmentAuditor,
  EvaluationWorkflowStatus,
  QuestionItem,
  RemediationAction,
  RiskRecord,
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
    vi.spyOn(RiskRecord, 'findAll').mockResolvedValue([]);
    vi.spyOn(AssessmentAsset, 'findAll').mockResolvedValue([]);

    const result = await workItemService.list(auditor);

    expect(result.counts.review).toBe(1);
    expect(result.review[0]).toMatchObject({ id: item.id, assignedTo: auditor.userId });
    expect(findEvaluations.mock.calls[1][0]).toEqual(expect.objectContaining({
      where: expect.not.objectContaining({ assignedTo: expect.anything() }),
    }));
  });

  test('returns serializable verification DTOs for an independent risk reviewer', async () => {
    const action: any = {
      id: 'action-1',
      ownerUserId: 'owner-1',
      toJSON: () => ({
        id: 'action-1',
        ownerUserId: 'owner-1',
        riskLinks: [{ riskId: 'risk-1', risk: { taskId: null, reviewerUserId: auditor.userId } }],
        findingLinks: [],
      }),
    };
    vi.spyOn(AssessmentAuditor, 'findAll').mockResolvedValue([]);
    vi.spyOn(QuestionItem, 'findAll').mockResolvedValue([]);
    vi.spyOn(RemediationAction, 'findAll')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([action]);
    vi.spyOn(RiskRecord, 'findAll').mockResolvedValue([]);

    const result = await workItemService.list(auditor);

    expect(result.counts.verify).toBe(1);
    expect(result.verify[0]).toEqual(expect.objectContaining({
      id: 'action-1',
      riskLinks: [expect.objectContaining({ riskId: 'risk-1' })],
    }));
    expect(JSON.stringify(result.verify)).toContain('action-1');
  });
});
