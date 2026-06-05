import { Op } from 'sequelize';
import {
  AuditTask,
  QuestionItem,
  User,
  TaskStatus,
  AnswerStatus,
  OperationType,
  NotificationType,
  RiskRecord,
} from '../models';
import auditLogService from './audit-log.service';
import notificationService from './notification.service';
import emailService from './email.service';

class TaskLifecycleService {

  async assignTask(taskId: string, updatedBy: string) {
    const task = await AuditTask.findByPk(taskId);
    if (!task) throw new Error('任务不存在');
    if (task.status !== TaskStatus.DRAFT) throw new Error('只有草稿状态的任务可以分配');
    task.status = TaskStatus.ASSIGNED;
    await task.save();

    if (!task.assignedTo) throw new Error('任务未分配用户');

    await notificationService.create({
      userId: task.assignedTo,
      taskId: task.id,
      type: NotificationType.TASK_ASSIGNED,
      title: '新审计任务已分配',
      content: `您有一个新的审计任务: ${task.assessmentTarget}`,
    } as any);

    const assigneeUser = await User.findByPk(task.assignedTo);
    if (assigneeUser?.email) {
      await emailService.notifyTaskAssigned(
        assigneeUser.email, assigneeUser.username,
        task.assessmentTarget, task.assessmentType,
      );
    }

    await auditLogService.log({
      userId: updatedBy,
      operationType: OperationType.UPDATE,
      resourceType: 'task',
      resourceId: taskId,
      operationDetails: '分配审计任务',
      success: true,
    });

    return task;
  }

  async submitTask(taskId: string, submittedBy: string) {
    const task = await AuditTask.findByPk(taskId);
    if (!task) throw new Error('任务不存在');
    if (![TaskStatus.DRAFT, TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS].includes(task.status)) {
      throw new Error('只有未完成状态的任务可以提交');
    }

    const unansweredCount = await QuestionItem.count({
      where: { taskId, assignedTo: submittedBy, answerStatus: { [Op.ne]: AnswerStatus.ANSWERED } },
    });
    if (unansweredCount > 0) throw new Error(`还有 ${unansweredCount} 道题目未作答`);

    const allTotal = await QuestionItem.count({ where: { taskId } });
    const allAnswered = await QuestionItem.count({ where: { taskId, answerStatus: AnswerStatus.ANSWERED } });
    task.status = allTotal === allAnswered ? TaskStatus.SUBMITTED : TaskStatus.IN_PROGRESS;
    task.submittedAt = new Date();
    await task.save();

    await notificationService.create({
      userId: task.createdBy,
      taskId: task.id,
      type: NotificationType.TASK_SUBMITTED,
      title: '审计任务已提交',
      content: `"${task.assessmentTarget}" 已完成答题并提交`,
    } as any);

    await auditLogService.log({
      userId: submittedBy,
      operationType: OperationType.UPDATE,
      resourceType: 'task',
      resourceId: taskId,
      operationDetails: '提交审计任务',
      success: true,
    });

    return task;
  }

  async returnTask(taskId: string, assigneeIds: string[], returnReason: string, returnedBy: string) {
    const task = await AuditTask.findByPk(taskId);
    if (!task) throw new Error('任务不存在');
    if (task.status !== TaskStatus.SUBMITTED && task.status !== TaskStatus.UNDER_REVIEW) {
      throw new Error('只有已提交或待审阅状态的任务可以退回');
    }
    if (!returnReason) throw new Error('退回原因不能为空');
    if (!assigneeIds || assigneeIds.length === 0) throw new Error('请选择要退回的责任人');

    // 重置被退回责任人的题目状态
    await QuestionItem.update(
      { answerStatus: AnswerStatus.PENDING },
      { where: { taskId, assignedTo: { [Op.in]: assigneeIds } } }
    );

    task.status = TaskStatus.IN_PROGRESS;
    task.returnReason = returnReason;
    task.returnedAssignees = assigneeIds;
    await task.save();

    // 通知每个被退回的责任人
    for (const uid of assigneeIds) {
      await notificationService.create({
        userId: uid,
        taskId: task.id,
        type: NotificationType.TASK_RETURNED,
        title: '审计任务已被退回',
        content: `"${task.assessmentTarget}" 已被退回，原因: ${returnReason}`,
      } as any);

      const returnedUser = await User.findByPk(uid);
      if (returnedUser?.email) {
        await emailService.notifyTaskReturned(
          returnedUser.email, returnedUser.username,
          task.assessmentTarget, returnReason,
        );
      }
    }

    await auditLogService.log({
      userId: returnedBy,
      operationType: OperationType.UPDATE,
      resourceType: 'task',
      resourceId: taskId,
      operationDetails: `退回任务给 ${assigneeIds.length} 人，原因: ${returnReason}`,
      success: true,
    });

    return task;
  }

  async completeReview(taskId: string, reviewerId: string) {
    const task = await AuditTask.findByPk(taskId);
    if (!task) throw new Error('任务不存在');
    if (task.status !== TaskStatus.UNDER_REVIEW && task.status !== TaskStatus.SUBMITTED) {
      throw new Error('只有已提交或审核中状态的任务可以完成审阅');
    }

    task.status = TaskStatus.COMPLETED;
    task.reviewedAt = new Date();
    await task.save();

    // 自动生成风险记录
    const reviewedItems = await QuestionItem.findAll({
      where: { taskId, riskIdentification: { [Op.ne]: null } },
    });
    for (const item of reviewedItems) {
      if (item.riskIdentification && item.riskIdentification.trim()) {
        await RiskRecord.create({
          taskId,
          questionItemId: item.id,
          assessmentType: task.assessmentType,
          assessmentTarget: task.assessmentTarget,
          riskIdentification: item.riskIdentification,
          riskLevel: item.riskLevel || 'low',
          remediationMeasures: item.remediationMeasures || null,
          remediationStatus: 'not_remediated',
          riskStatus: 'risk_reduction',
        } as any);
      }
    }

    await auditLogService.log({
      userId: reviewerId,
      operationType: OperationType.UPDATE,
      resourceType: 'task',
      resourceId: taskId,
      operationDetails: '完成审核',
      success: true,
    });

    return task;
  }
}

export default new TaskLifecycleService();
