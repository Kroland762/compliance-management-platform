import { Router, Request, Response } from 'express';
import { Op } from 'sequelize';
import { authenticate, authorize } from '../middlewares/auth';
import taskService from '../services/task.service';
import taskLifecycleService from '../services/task-lifecycle.service';

const router = Router();
router.use(authenticate);

router.post('/', authorize('tasks', 'create'), async (req: Request, res: Response) => {
  try {
    // assignedTo 不再必填 — 创建草稿任务，后续再指派
    const task = await taskService.createTask({ ...req.body, createdBy: req.user!.userId });
    res.status(201).json({ success: true, data: task });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'CREATE_FAILED', message: error.message } });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await taskService.getTasksWithStats({ ...req.query, userId: req.user!.userId, userRole: req.user!.role } as any);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

router.get('/:id/questions', async (req: Request, res: Response) => {
  try {
    const questionnaireService = (await import('../services/questionnaire.service')).default;
    const questions = await questionnaireService.getQuestions(req.params.id, req.user!.userId);
    res.json({ success: true, data: { questions } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const task = await taskService.getTaskById(req.params.id);
    res.json({ success: true, data: task });
  } catch (error: any) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: error.message } });
  }
});

router.post('/:id/submit', async (req: Request, res: Response) => {
  try {
    const task = await taskLifecycleService.submitTask(req.params.id, req.user!.userId);
    res.json({ success: true, data: task });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'SUBMIT_FAILED', message: error.message } });
  }
});

router.post('/:id/return', authorize('tasks', 'update'), async (req: Request, res: Response) => {
  try {
    const { assigneeIds, reason } = req.body;
    const task = await taskLifecycleService.returnTask(req.params.id, assigneeIds, reason, req.user!.userId);
    res.json({ success: true, data: task });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'RETURN_FAILED', message: error.message } });
  }
});

router.post('/:id/complete-review', authorize('tasks', 'update'), async (req: Request, res: Response) => {
  try {
    const task = await taskLifecycleService.completeReview(req.params.id, req.user!.userId);
    res.json({ success: true, data: task });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'COMPLETE_FAILED', message: error.message } });
  }
});

// 审计员配置任务：更新问题责任分配
router.put('/:id/configure', authorize('tasks', 'update'), async (req: Request, res: Response) => {
  try {
    const { questionAssignments } = req.body;
    const { QuestionItem, AuditTask, TaskStatus, NotificationType } = await import('../models');
    const notificationService = (await import('../services/notification.service')).default;

    const notifiedUsers = new Set<string>();

    if (questionAssignments) {
      for (const qa of questionAssignments) {
        await QuestionItem.update(
          { responsibleDepartment: qa.responsibleDepartment, responsiblePerson: qa.responsiblePerson,
            referenceAnswer: qa.referenceAnswer, historicalEvidencePath: qa.historicalEvidencePath,
            assignedTo: qa.assignedTo || null },
          { where: { id: qa.questionId } }
        );
        if (qa.assignedTo) {
          if (!notifiedUsers.has(qa.assignedTo)) {
            notifiedUsers.add(qa.assignedTo);
          }
        }
      }
    }

    // 全部题目都指派了 → 草稿变已分配，同步任务级 assignedTo
    const task = await AuditTask.findByPk(req.params.id);
    if (task) {
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
    res.status(400).json({ success: false, error: { code: 'CONFIGURE_FAILED', message: error.message } });
  }
});

// 删除任务（仅管理员）
router.delete('/:id', authorize('tasks', 'delete'), async (req: Request, res: Response) => {
  try {
    const { AuditTask, QuestionItem, EvidenceFile, Notification, AuditLog, OperationType } = await import('../models');
    const task = await AuditTask.findByPk(req.params.id);
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
    res.status(400).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
});

// 手动发送催办邮件
router.post('/:id/remind', authenticate, async (req: Request, res: Response) => {
  try {
    const { AuditTask, User } = await import('../models');
    const emailService = (await import('../services/email.service')).default;
    const task = await AuditTask.findByPk(req.params.id);
    if (!task) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '任务不存在' } }); return; }
    const user = await User.findByPk(task.assignedTo);
    if (!user || !user.email) { res.status(400).json({ success: false, error: { code: 'NO_EMAIL', message: '普通用户未设置邮箱' } }); return; }
    const sent = await emailService.sendReminder(user.email, user.username, task.assessmentTarget);
    if (sent) {
      res.json({ success: true, message: '催办邮件已发送' });
    } else {
      res.json({ success: true, message: 'SMTP 未配置，邮件未发送（系统通知已生效）' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'REMIND_FAILED', message: error.message } });
  }
});

export default router;
