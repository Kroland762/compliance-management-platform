import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import taskService from '../services/task.service';
import taskLifecycleService from '../services/task-lifecycle.service';
import objectAccessService from '../services/object-access.service';
import { AppError } from '../utils/http';
import assessmentAuditorService from '../services/assessment-auditor.service';
import evaluationService from '../services/evaluation.service';

const router = Router();
router.use(authenticate);

function sendError(res: Response, error: any, status: number, code: string): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  res.status(status).json({ success: false, error: { code, message: error.message } });
}

router.post('/', authorize('tasks', 'create'), async (req: Request, res: Response) => {
  try {
    const departmentId = req.body.departmentId || req.user!.primaryDepartmentId;
    if (!departmentId) throw new AppError(400, 'PRIMARY_DEPARTMENT_REQUIRED', '请选择任务归属部门');
    // assignedTo 不再必填 — 创建草稿任务，后续再指派
    const task = await taskService.createTask({ ...req.body, departmentId, createdBy: req.user!.userId }, req.user!);
    res.status(201).json({ success: true, data: task });
  } catch (error: any) {
    sendError(res, error, 400, 'CREATE_FAILED');
  }
});

router.get('/', authorize('tasks', 'read'), async (req: Request, res: Response) => {
  try {
    const result = await taskService.getTasksWithStats({ ...req.query, userId: req.user!.userId, user: req.user! } as any);
    res.json({ success: true, data: result });
  } catch (error: any) {
    sendError(res, error, 500, 'QUERY_FAILED');
  }
});

router.get('/:id/questions', authorize('tasks', 'read'), async (req: Request, res: Response) => {
  try {
    await objectAccessService.taskOrNotFound(req.params.id, req.user!);
    const questionnaireService = (await import('../services/questionnaire.service')).default;
    const questions = await questionnaireService.getQuestions(req.params.id, req.user!);
    res.json({ success: true, data: { questions } });
  } catch (error: any) {
    sendError(res, error, 500, 'QUERY_FAILED');
  }
});

router.post('/:id/evaluations/bulk-submit', authorize('evaluations', 'submit'), async (req: Request, res: Response) => {
  try {
    const data = await evaluationService.bulkSubmit(req.params.id, req.body.items || [], req.user!);
    res.json({ success: true, data });
  } catch (error: any) {
    sendError(res, error, 400, 'BULK_SUBMIT_FAILED');
  }
});

router.get('/:id', authorize('tasks', 'read'), async (req: Request, res: Response) => {
  try {
    await objectAccessService.taskOrNotFound(req.params.id, req.user!);
    const task = await taskService.getTaskById(req.params.id);
    res.json({ success: true, data: task });
  } catch (error: any) {
    sendError(res, error, 404, 'NOT_FOUND');
  }
});

router.put('/:id/column-schema/sync', authorize('tasks', 'update'), async (req: Request, res: Response) => {
  try {
    await objectAccessService.taskOrNotFound(req.params.id, req.user!, 'update');
    const result = await taskService.syncColumnSchema(req.params.id, req.user!.userId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    sendError(res, error, 409, 'COLUMN_SCHEMA_SYNC_FAILED');
  }
});

router.put('/:id/auditors', authorize('tasks', 'update'), async (req: Request, res: Response) => {
  try {
    const items = await assessmentAuditorService.replace(req.params.id, req.body.auditorUserIds || [], req.user!);
    res.json({ success: true, data: { items } });
  } catch (error: any) {
    sendError(res, error, 400, 'AUDITOR_ASSIGNMENT_FAILED');
  }
});

router.post('/:id/submit', authorize('tasks', 'submit'), async (_req: Request, res: Response) => {
  res.status(410).json({
    success: false,
    error: {
      code: 'LEGACY_WRITE_PATH_DISABLED',
      message: '旧整任务提交接口已停用，请逐项使用 /api/evaluations/:id/submit',
    },
  });
});

router.post('/:id/return', authorize('tasks', 'update'), async (_req: Request, res: Response) => {
  res.status(410).json({
    success: false,
    error: {
      code: 'LEGACY_WRITE_PATH_DISABLED',
      message: '旧整任务退回接口已停用，请逐项使用 /api/evaluations/:id/review',
    },
  });
});

router.post('/:id/complete-review', authorize('tasks', 'update'), async (req: Request, res: Response) => {
  try {
    await objectAccessService.taskOrNotFound(req.params.id, req.user!, 'update');
    const task = await taskLifecycleService.completeReview(req.params.id, req.user!.userId);
    res.json({ success: true, data: task });
  } catch (error: any) {
    sendError(res, error, 400, 'COMPLETE_FAILED');
  }
});

router.post('/:id/close', authorize('tasks', 'update'), async (req: Request, res: Response) => {
  try {
    await objectAccessService.taskOrNotFound(req.params.id, req.user!, 'update');
    const task = await taskLifecycleService.closeAssessment(req.params.id, req.user!.userId);
    res.json({ success: true, data: task });
  } catch (error: any) {
    sendError(res, error, 409, 'ASSESSMENT_CLOSE_BLOCKED');
  }
});

// 审计员配置任务：更新问题责任分配
router.put('/:id/configure', authorize('tasks', 'update'), async (_req: Request, res: Response) => {
  res.status(410).json({
    success: false,
    error: {
      code: 'LEGACY_WRITE_PATH_DISABLED',
      message: '旧任务配置接口已停用，请使用评估范围、矩阵和发布接口',
    },
  });
});

// 删除任务（仅管理员）
router.delete('/:id', authorize('tasks', 'delete'), async (req: Request, res: Response) => {
  try {
    const { OperationType } = await import('../models');
    const task = await objectAccessService.taskOrNotFound(req.params.id, req.user!);
    if (!task) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '任务不存在' } });
      return;
    }
    await task.destroy();
    // Audit log
    const auditLogService = (await import('../services/audit-log.service')).default;
    await auditLogService.log({
      userId: req.user!.userId, operationType: OperationType.DELETE, resourceType: 'task',
      resourceId: req.params.id, success: true, operationDetails: `删除审计任务`,
    });
    res.json({ success: true, message: '任务已删除' });
  } catch (error: any) {
    sendError(res, error, 400, 'DELETE_FAILED');
  }
});

// 新评估流程只发送系统内催办，不向外部邮箱发送内容。
router.post('/:id/remind', authenticate, async (req: Request, res: Response) => {
  try {
    const { NotificationType } = await import('../models');
    const notificationService = (await import('../services/notification.service')).default;
    const task = await objectAccessService.taskOrNotFound(req.params.id, req.user!);
    if (!task.assignedTo) { res.status(400).json({ success: false, error: { code: 'NO_ASSIGNEE', message: '任务未分配用户' } }); return; }
    await notificationService.create({
      userId: task.assignedTo,
      taskId: task.id,
      type: NotificationType.TASK_ASSIGNED,
      title: '评估任务催办',
      content: `请及时处理评估任务：${task.name || task.assessmentTarget}`,
    });
    res.json({ success: true, message: '系统通知已发送' });
  } catch (error: any) {
    sendError(res, error, 500, 'REMIND_FAILED');
  }
});

export default router;
