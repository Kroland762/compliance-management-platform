import { afterEach, describe, expect, test, vi } from 'vitest';
import sequelize from '../src/config/database';
import {
  AuditTask,
  AssessmentAuditor,
  AnswerStatus,
  ComplianceStatus,
  Department,
  EvaluationHistoryLink,
  EvaluationWorkflowStatus,
  Finding,
  FindingActionLink,
  FindingDisposition,
  FindingStatus,
  QuestionItem,
  RiskFindingLink,
  RiskLevel,
  RiskSource,
  TaskStatus,
  TenantMember,
} from '../src/models';
import { decrypt } from '../src/utils/crypto';
import auditLogService from '../src/services/audit-log.service';
import evaluationService from '../src/services/evaluation.service';
import findingService from '../src/services/finding.service';
import memberContextService from '../src/services/member-context.service';
import notificationService from '../src/services/notification.service';
import objectAccessService from '../src/services/object-access.service';

const actor = {
  userId: 'admin-1',
  username: 'admin',
  role: '管理员',
  roleIds: [],
  tenantId: 'tenant-1',
  permissions: { tasks: ['read', 'update'], evaluations: ['read'] },
  permissionScopes: { tasks: { read: 'all', update: 'all' }, evaluations: { read: 'all' } },
  departmentIds: ['department-1'],
  isGlobalAdmin: false,
  tokenKind: 'tenant',
} as any;

const reviewActor = {
  ...actor,
  userId: 'reviewer-1',
  permissions: { ...actor.permissions, evaluations: ['read', 'answer', 'submit', 'claim', 'review'] },
} as any;

function evaluation(overrides: Record<string, unknown> = {}) {
  const item: any = {
    id: 'evaluation-1',
    taskId: 'task-1',
    assignedTo: 'old-user',
    responsiblePerson: '旧责任人',
    responsibleDepartment: '旧部门',
    responsibleDepartmentId: 'department-1',
    workflowStatus: EvaluationWorkflowStatus.IN_PROGRESS,
    lockVersion: 2,
    update: vi.fn(async (values) => {
      Object.assign(item, values);
      return item;
    }),
    ...overrides,
  };
  return item;
}

describe('evaluation assignee updates', () => {
  afterEach(() => vi.restoreAllMocks());

  test('updates an editable row, audits the change, and notifies the new assignee', async () => {
    const item = evaluation();
    vi.spyOn(objectAccessService, 'evaluationOrNotFound').mockResolvedValue(item);
    vi.spyOn(objectAccessService, 'taskOrNotFound').mockResolvedValue({ id: 'task-1' } as any);
    vi.spyOn(memberContextService, 'resolve').mockResolvedValue({
      member: { displayName: '新责任人' },
      primaryDepartmentId: 'department-2',
      primaryDepartmentName: '安全部',
    } as any);
    vi.spyOn(sequelize, 'transaction').mockImplementation(async (callback: any) => callback({ LOCK: { UPDATE: 'UPDATE' } }));
    vi.spyOn(QuestionItem, 'findByPk').mockResolvedValue(item);
    vi.spyOn(AuditTask, 'findByPk').mockResolvedValue({ name: '年度评估' } as any);
    const audit = vi.spyOn(auditLogService, 'log').mockResolvedValue(undefined);
    const notify = vi.spyOn(notificationService, 'notifyTaskAssigned').mockResolvedValue({} as any);
    vi.spyOn(evaluationService, 'detail').mockResolvedValue({ id: item.id, assignedTo: 'new-user' });

    const result = await evaluationService.updateAssignee(item.id, 'new-user', 2, actor);

    expect(item.update).toHaveBeenCalledWith(expect.objectContaining({
      assignedTo: 'new-user',
      responsiblePerson: '新责任人',
      responsibleDepartment: '安全部',
      responsibleDepartmentId: 'department-2',
      lockVersion: 3,
    }), expect.any(Object));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      operationDetails: '改派评估单元责任人至 新责任人',
      resourceId: item.id,
    }), expect.any(Object));
    expect(notify).toHaveBeenCalledWith('new-user', 'task-1', '年度评估');
    expect(result).toMatchObject({ assignedTo: 'new-user' });
  });

  test('rejects reassignment after submission', async () => {
    const item = evaluation({ workflowStatus: EvaluationWorkflowStatus.SUBMITTED });
    vi.spyOn(objectAccessService, 'evaluationOrNotFound').mockResolvedValue(item);
    vi.spyOn(objectAccessService, 'taskOrNotFound').mockResolvedValue({ id: 'task-1' } as any);
    vi.spyOn(memberContextService, 'resolve').mockResolvedValue({
      member: { displayName: '新责任人' }, primaryDepartmentId: 'department-2', primaryDepartmentName: '安全部',
    } as any);
    vi.spyOn(sequelize, 'transaction').mockImplementation(async (callback: any) => callback({ LOCK: { UPDATE: 'UPDATE' } }));
    vi.spyOn(QuestionItem, 'findByPk').mockResolvedValue(item);

    await expect(evaluationService.updateAssignee(item.id, 'new-user', 2, actor))
      .rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(item.update).not.toHaveBeenCalled();
  });
});

describe('atomic bulk evaluation submission', () => {
  afterEach(() => vi.restoreAllMocks());

  test('persists a draft and submits it in the same transaction', async () => {
    const item = evaluation({
      assignedTo: actor.userId,
      currentStatusDescription: '旧回答',
      workflowStatus: EvaluationWorkflowStatus.IN_PROGRESS,
    });
    const task = { id: 'task-1', status: TaskStatus.READY, update: vi.fn() };
    vi.spyOn(objectAccessService, 'taskOrNotFound').mockResolvedValue(task as any);
    vi.spyOn(sequelize, 'transaction').mockImplementation(async (callback: any) => callback({ LOCK: { UPDATE: 'UPDATE' } }));
    vi.spyOn(QuestionItem, 'findAll').mockResolvedValue([item]);
    vi.spyOn(QuestionItem, 'count').mockResolvedValue(4);
    vi.spyOn(AuditTask, 'findByPk').mockResolvedValue(task as any);
    vi.spyOn(AssessmentAuditor, 'findAll').mockResolvedValue([]);
    vi.spyOn(auditLogService, 'log').mockResolvedValue(undefined);
    vi.spyOn(evaluationService, 'list').mockResolvedValue({ items: [], pagination: {} } as any);

    await evaluationService.bulkSubmit('task-1', [{
      id: item.id,
      lockVersion: 2,
      currentStatusDescription: '  一次请求保存并提交  ',
    }], actor);

    const update = item.update.mock.calls[0][0];
    expect(decrypt(update.currentStatusDescription)).toBe('一次请求保存并提交');
    expect(update).toMatchObject({
      answerStatus: AnswerStatus.ANSWERED,
      workflowStatus: EvaluationWorkflowStatus.SUBMITTED,
      lockVersion: 3,
    });
    expect(task.update).toHaveBeenCalledWith({ status: TaskStatus.IN_PROGRESS }, expect.any(Object));
  });
});

describe('evaluation direct self-review', () => {
  afterEach(() => vi.restoreAllMocks());

  test('lets an administrator with answer and review permissions complete an in-progress row', async () => {
    const item = evaluation({
      assignedTo: 'another-member',
      currentStatusDescription: '已完成现场检查',
      workflowStatus: EvaluationWorkflowStatus.IN_PROGRESS,
    });
    const task = { status: 'in_progress', update: vi.fn() };
    vi.spyOn(objectAccessService, 'evaluationOrNotFound').mockResolvedValue(item);
    vi.spyOn(sequelize, 'transaction').mockImplementation(async (callback: any) => callback({ LOCK: { UPDATE: 'UPDATE' } }));
    vi.spyOn(QuestionItem, 'findByPk').mockResolvedValue(item);
    vi.spyOn(QuestionItem, 'count').mockResolvedValue(1);
    vi.spyOn(AuditTask, 'findByPk').mockResolvedValue(task as any);
    vi.spyOn(auditLogService, 'log').mockResolvedValue(undefined);
    vi.spyOn(evaluationService as any, 'refreshFutureHistoryLinks').mockResolvedValue(undefined);
    vi.spyOn(evaluationService, 'detail').mockResolvedValue({
      id: item.id,
      workflowStatus: EvaluationWorkflowStatus.REVIEWED,
      complianceStatus: ComplianceStatus.COMPLIANT,
    });

    const result = await evaluationService.review(item.id, {
      complianceStatus: ComplianceStatus.COMPLIANT,
      return: false,
    }, reviewActor, 2);

    expect(item.update).toHaveBeenCalledWith(expect.objectContaining({
      workflowStatus: EvaluationWorkflowStatus.REVIEWED,
      complianceStatus: ComplianceStatus.COMPLIANT,
      reviewedBy: reviewActor.userId,
      lockVersion: 3,
    }), expect.any(Object));
    expect(task.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ complianceStatus: ComplianceStatus.COMPLIANT });
  });

  test('returns a claimed row without requiring a compliance conclusion', async () => {
    const item = evaluation({
      assignedTo: 'another-member',
      reviewClaimedBy: reviewActor.userId,
      currentStatusDescription: '已提交回答',
      workflowStatus: EvaluationWorkflowStatus.SUBMITTED,
    });
    const task = { status: TaskStatus.PENDING_REVIEW, update: vi.fn() };
    vi.spyOn(objectAccessService, 'evaluationOrNotFound').mockResolvedValue(item);
    vi.spyOn(sequelize, 'transaction').mockImplementation(async (callback: any) => callback({ LOCK: { UPDATE: 'UPDATE' } }));
    vi.spyOn(QuestionItem, 'findByPk').mockResolvedValue(item);
    vi.spyOn(QuestionItem, 'count').mockResolvedValue(1);
    vi.spyOn(AuditTask, 'findByPk').mockResolvedValue(task as any);
    vi.spyOn(auditLogService, 'log').mockResolvedValue(undefined);
    vi.spyOn(evaluationService, 'detail').mockResolvedValue({ id: item.id, workflowStatus: EvaluationWorkflowStatus.RETURNED });

    await evaluationService.review(item.id, { return: true }, reviewActor, 2);

    expect(item.update).toHaveBeenCalledWith(expect.objectContaining({
      workflowStatus: EvaluationWorkflowStatus.RETURNED,
      complianceStatus: ComplianceStatus.NOT_ASSESSED,
      reviewClaimedBy: null,
      lockVersion: 3,
    }), expect.any(Object));
    expect(task.update).toHaveBeenCalledWith({ status: TaskStatus.IN_PROGRESS }, expect.any(Object));
  });
});

describe('administrator review reopening', () => {
  afterEach(() => vi.restoreAllMocks());

  test('reopens a reviewed row, cancels an unprocessed finding, and audits the reason', async () => {
    const item = evaluation({
      workflowStatus: EvaluationWorkflowStatus.REVIEWED,
      complianceStatus: ComplianceStatus.NON_COMPLIANT,
      reviewedBy: 'reviewer-1',
      reviewedAt: new Date(),
      submittedAt: new Date(),
      reviewClaimedBy: 'reviewer-1',
      reviewClaimedAt: new Date(),
    });
    const task: any = {
      id: 'task-1', status: TaskStatus.PENDING_CLOSURE, lockVersion: 4,
      submittedAt: new Date(), reviewedAt: new Date(), update: vi.fn(),
    };
    const finding: any = {
      id: 'finding-1', status: FindingStatus.OPEN, disposition: FindingDisposition.PENDING,
      lockVersion: 1, update: vi.fn(),
    };
    vi.spyOn(objectAccessService, 'evaluationOrNotFound').mockResolvedValue(item);
    vi.spyOn(sequelize, 'transaction').mockImplementation(async (callback: any) => callback({ LOCK: { UPDATE: 'UPDATE' } }));
    vi.spyOn(QuestionItem, 'findByPk').mockResolvedValue(item);
    vi.spyOn(AuditTask, 'findByPk').mockResolvedValue(task);
    vi.spyOn(Finding, 'findOne').mockResolvedValue(finding);
    vi.spyOn(RiskSource, 'count').mockResolvedValue(0);
    vi.spyOn(FindingActionLink, 'count').mockResolvedValue(0);
    vi.spyOn(RiskFindingLink, 'count').mockResolvedValue(0);
    const destroyHistory = vi.spyOn(EvaluationHistoryLink, 'destroy').mockResolvedValue(1);
    const audit = vi.spyOn(auditLogService, 'log').mockResolvedValue(undefined);
    vi.spyOn(evaluationService, 'detail').mockResolvedValue({ id: item.id, workflowStatus: EvaluationWorkflowStatus.IN_PROGRESS });

    const result = await evaluationService.reopenReview(item.id, '结论录入错误', 2, actor);

    expect(finding.update).toHaveBeenCalledWith(expect.objectContaining({ status: FindingStatus.CANCELLED, lockVersion: 2 }), expect.any(Object));
    expect(item.update).toHaveBeenCalledWith(expect.objectContaining({
      workflowStatus: EvaluationWorkflowStatus.IN_PROGRESS,
      complianceStatus: ComplianceStatus.NOT_ASSESSED,
      reviewedBy: null,
      reviewedAt: null,
      submittedAt: null,
      reviewClaimedBy: null,
      lockVersion: 3,
    }), expect.any(Object));
    expect(task.update).toHaveBeenCalledWith(expect.objectContaining({
      status: TaskStatus.IN_PROGRESS,
      submittedAt: null,
      reviewedAt: null,
      lockVersion: 5,
    }), expect.any(Object));
    expect(destroyHistory).toHaveBeenCalledWith({ where: { sourceEvaluationId: item.id }, transaction: expect.anything() });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      operationDetails: expect.stringContaining('结论录入错误'),
      reasonCode: 'ADMIN_REOPEN_REVIEW',
      relatedResourceIds: { findingId: finding.id },
    }), expect.any(Object));
    expect(result).toMatchObject({ workflowStatus: EvaluationWorkflowStatus.IN_PROGRESS });
  });

  test('blocks reopening when downstream remediation exists', async () => {
    const item = evaluation({ workflowStatus: EvaluationWorkflowStatus.REVIEWED, complianceStatus: ComplianceStatus.NON_COMPLIANT });
    const task: any = { id: 'task-1', status: TaskStatus.PENDING_CLOSURE, lockVersion: 1, update: vi.fn() };
    const finding: any = {
      id: 'finding-1', status: FindingStatus.OPEN, disposition: FindingDisposition.PENDING,
      lockVersion: 0, update: vi.fn(),
    };
    vi.spyOn(objectAccessService, 'evaluationOrNotFound').mockResolvedValue(item);
    vi.spyOn(sequelize, 'transaction').mockImplementation(async (callback: any) => callback({ LOCK: { UPDATE: 'UPDATE' } }));
    vi.spyOn(QuestionItem, 'findByPk').mockResolvedValue(item);
    vi.spyOn(AuditTask, 'findByPk').mockResolvedValue(task);
    vi.spyOn(Finding, 'findOne').mockResolvedValue(finding);
    vi.spyOn(RiskSource, 'count').mockResolvedValue(0);
    vi.spyOn(FindingActionLink, 'count').mockResolvedValue(1);
    vi.spyOn(RiskFindingLink, 'count').mockResolvedValue(0);

    await expect(evaluationService.reopenReview(item.id, '需要修正', 2, actor))
      .rejects.toMatchObject({ code: 'DOWNSTREAM_EXISTS', statusCode: 409 });
    expect(item.update).not.toHaveBeenCalled();
    expect(finding.update).not.toHaveBeenCalled();
  });
});

describe('finding recreation after a review is reopened', () => {
  afterEach(() => vi.restoreAllMocks());

  test('reactivates and updates the cancelled finding instead of creating a duplicate', async () => {
    const item = evaluation({ controlPoint: '身份鉴别', assignedTo: 'owner-1' });
    const existing: any = {
      id: 'finding-1', status: FindingStatus.CANCELLED, disposition: FindingDisposition.PENDING,
      lockVersion: 2, update: vi.fn(),
    };
    vi.spyOn(Department, 'findOne').mockResolvedValue({ id: 'department-1' } as any);
    vi.spyOn(TenantMember, 'findOne').mockResolvedValue({ userId: 'owner-1' } as any);
    vi.spyOn(Finding, 'findOne').mockResolvedValue(existing);
    const create = vi.spyOn(Finding, 'create');

    const transaction = { LOCK: { UPDATE: 'UPDATE' } } as any;
    const result = await findingService.createForReview(item, {
      description: '复核后确认未启用多因素认证',
      severity: RiskLevel.HIGH,
    }, reviewActor, transaction);

    expect(existing.update).toHaveBeenCalledWith(expect.objectContaining({
      description: '复核后确认未启用多因素认证',
      severity: RiskLevel.HIGH,
      status: FindingStatus.OPEN,
      disposition: FindingDisposition.PENDING,
      resolvedBy: null,
      lockVersion: 3,
    }), { transaction });
    expect(create).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });
});
