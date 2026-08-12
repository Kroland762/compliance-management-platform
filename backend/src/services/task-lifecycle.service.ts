import { Op } from 'sequelize';
import sequelize from '../config/database';
import {
  AuditTask,
  EvaluationWorkflowStatus,
  Finding,
  FindingStatus,
  OperationType,
  QuestionItem,
  TaskStatus,
} from '../models';
import auditLogService from './audit-log.service';

class TaskLifecycleService {
  async completeReview(taskId: string, reviewerId: string) {
    return sequelize.transaction(async (transaction) => {
      const task = await AuditTask.findByPk(taskId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!task) throw new Error('任务不存在');
      if (task.status === TaskStatus.PENDING_CLOSURE || task.status === TaskStatus.CLOSED) return task;
      const unreviewed = await QuestionItem.count({
        where: { taskId, workflowStatus: { [Op.ne]: EvaluationWorkflowStatus.REVIEWED } },
        transaction,
      });
      if (unreviewed > 0) throw new Error(`还有 ${unreviewed} 个评估单元尚未复核`);

      task.status = TaskStatus.PENDING_CLOSURE;
      task.reviewedAt = new Date();
      await task.save({ transaction });

      await auditLogService.log({
        userId: reviewerId,
        operationType: OperationType.UPDATE,
        resourceType: 'task',
        resourceId: taskId,
        operationDetails: '全部评估单元复核完成，进入待闭环状态',
        success: true,
      }, transaction);

      return task;
    });
  }

  async closeAssessment(taskId: string, closedBy: string) {
    return sequelize.transaction(async (transaction) => {
      const task = await AuditTask.findByPk(taskId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!task) throw new Error('评估项目不存在');
      if (task.status === TaskStatus.CLOSED) return task;
      if (task.status !== TaskStatus.PENDING_CLOSURE) throw new Error('只有待闭环的评估项目可以关闭');
      const unresolved = await Finding.count({
        where: { taskId, status: { [Op.notIn]: [FindingStatus.RESOLVED, FindingStatus.CANCELLED] } },
        transaction,
      });
      if (unresolved > 0) throw new Error(`还有 ${unresolved} 个不符合项尚未解决`);
      await task.update({ status: TaskStatus.CLOSED, lockVersion: task.lockVersion + 1 }, { transaction });
      await auditLogService.log({
        userId: closedBy,
        operationType: OperationType.UPDATE,
        resourceType: 'assessment',
        resourceId: taskId,
        operationDetails: '关闭评估项目，所有不符合项均已闭环',
        success: true,
        departmentId: task.departmentId,
      }, transaction);
      return task;
    });
  }
}

export default new TaskLifecycleService();
