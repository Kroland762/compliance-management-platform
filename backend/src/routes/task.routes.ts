import { Router, Request, Response } from 'express';
import { Op } from 'sequelize';
import { authenticate, authorize } from '../middlewares/auth';
import taskService from '../services/task.service';
import taskLifecycleService from '../services/task-lifecycle.service';
import objectAccessService from '../services/object-access.service';
import { AppError } from '../utils/http';

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
    const task = await taskService.createTask({ ...req.body, departmentId, createdBy: req.user!.userId });
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

router.get('/:id', authorize('tasks', 'read'), async (req: Request, res: Response) => {
  try {
    await objectAccessService.taskOrNotFound(req.params.id, req.user!);
    const task = await taskService.getTaskById(req.params.id);
    res.json({ success: true, data: task });
  } catch (error: any) {
    sendError(res, error, 404, 'NOT_FOUND');
  }
});

router.post('/:id/submit', authorize('tasks', 'submit'), async (req: Request, res: Response) => {
  try {
    await objectAccessService.taskOrNotFound(req.params.id, req.user!, 'submit');
    const task = await taskLifecycleService.submitTask(req.params.id, req.user!.userId);
    res.json({ success: true, data: task });
  } catch (error: any) {
    sendError(res, error, 400, 'SUBMIT_FAILED');
  }
});

router.post('/:id/return', authorize('tasks', 'update'), async (req: Request, res: Response) => {
  try {
    const { assigneeIds, reason } = req.body;
    await objectAccessService.taskOrNotFound(req.params.id, req.user!, 'update');
    const task = await taskLifecycleService.returnTask(req.params.id, assigneeIds, reason, req.user!.userId);
    res.json({ success: true, data: task });
  } catch (error: any) {
    sendError(res, error, 400, 'RETURN_FAILED');
  }
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

// 审计员配置任务：更新问题责任分配
router.put('/:id/configure', authorize('tasks', 'update'), async (req: Request, res: Response) => {
  try {
    await objectAccessService.taskOrNotFound(req.params.id, req.user!, 'update');
    const { questionAssignments } = req.body;
    const { QuestionItem, TaskStatus, TenantMember, TenantMemberStatus, Department } = await import('../models');
    const notificationService = (await import('../services/notification.service')).default;

    const notifiedUsers = new Set<string>();

    if (questionAssignments) {
      const assigneeIds = Array.from(new Set(
        questionAssignments.map((item: any) => item.assignedTo).filter(Boolean),
      )) as string[];
      if (assigneeIds.length > 0) {
        const count = await TenantMember.count({
          where: { userId: { [Op.in]: assigneeIds }, status: TenantMemberStatus.ACTIVE },
        });
        if (count !== assigneeIds.length) throw new AppError(404, 'NOT_FOUND', '指派成员不存在');
      }
      for (const qa of questionAssignments) {
        const [updated] = await QuestionItem.update(
          { responsibleDepartment: qa.responsibleDepartment, responsiblePerson: qa.responsiblePerson,
            referenceAnswer: qa.referenceAnswer, historicalEvidencePath: qa.historicalEvidencePath,
            assignedTo: qa.assignedTo || null },
          { where: { id: qa.questionId, taskId: req.params.id } }
        );
        if (updated !== 1) throw new AppError(404, 'NOT_FOUND', '任务问题不存在');
        if (qa.assignedTo) {
          if (!notifiedUsers.has(qa.assignedTo)) {
            notifiedUsers.add(qa.assignedTo);
          }
        }
      }
    }

    // 全部题目都指派了 → 草稿变已分配，同步任务级 assignedTo
    const task = await objectAccessService.taskOrNotFound(req.params.id, req.user!, 'delete');
    if (task) {
      if (req.body.departmentId && req.body.departmentId !== task.departmentId) {
        const department = await Department.findOne({
          where: { id: req.body.departmentId, status: 'active' },
        });
        if (!department) throw new AppError(404, 'NOT_FOUND', '归属部门不存在');
        task.departmentId = department.id;
      }
      const totalQuestions = await QuestionItem.count({ where: { taskId: req.params.id } });
      const assignedQuestions = await QuestionItem.count({ where: { taskId: req.params.id, assignedTo: { [Op.ne]: null } } });
      
      // 同步任务级 assignedTo：取第一个被指派的题目的人员
      if (assignedQuestions > 0 && notifiedUsers.size > 0) {
        task.assignedTo = [...notifiedUsers][0];
      }
      
      if (assignedQuestions === totalQuestions && assignedQuestions > 0 && task.status === TaskStatus.DRAFT) {
        task.status = TaskStatus.ASSIGNED;
      }
      await task.save();
    }

    // 通知本次被指派的用户
    if (notifiedUsers.size > 0) {
      for (const uid of notifiedUsers) {
        await notificationService.notifyTaskAssigned(uid, req.params.id, task?.assessmentTarget || '');
      }
    }

    res.json({ success: true, message: '任务配置完成' });
  } catch (error: any) {
    sendError(res, error, 400, 'CONFIGURE_FAILED');
  }
});

// 删除任务（仅管理员）
router.delete('/:id', authorize('tasks', 'delete'), async (req: Request, res: Response) => {
  try {
    const { AuditTask, QuestionItem, EvidenceFile, Notification, AuditLog, OperationType } = await import('../models');
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

// 手动发送催办邮件
router.post('/:id/remind', authenticate, async (req: Request, res: Response) => {
  try {
    const { User } = await import('../models');
    const emailService = (await import('../services/email.service')).default;
    const task = await objectAccessService.taskOrNotFound(req.params.id, req.user!);
    if (!task.assignedTo) { res.status(400).json({ success: false, error: { code: 'NO_ASSIGNEE', message: '任务未分配用户' } }); return; }
    const user = await User.findByPk(task.assignedTo);
    if (!user || !user.email) { res.status(400).json({ success: false, error: { code: 'NO_EMAIL', message: '普通用户未设置邮箱' } }); return; }
    const sent = await emailService.sendReminder(user.email, user.username, task.assessmentTarget);
    if (sent) {
      res.json({ success: true, message: '催办邮件已发送' });
    } else {
      res.json({ success: true, message: 'SMTP 未配置，邮件未发送（系统通知已生效）' });
    }
  } catch (error: any) {
    sendError(res, error, 500, 'REMIND_FAILED');
  }
});

export default router;
