import {
  AuditTask,
  ComplianceStatus,
  EvaluationWorkflowStatus,
  OperationType,
  QuestionItem,
  TaskStatus,
} from '../models';
import { Op } from 'sequelize';
import { decrypt } from '../utils/crypto';
import auditLogService from './audit-log.service';

class ReviewService {
  async getReviewData(taskId: string) {
    const items = await QuestionItem.findAll({
      where: { taskId },
      include: [
        { association: 'asset' },
        { association: 'evidenceFiles', where: { status: 'active' }, required: false },
      ],
      order: [['sequenceNumber', 'ASC'], ['assetId', 'ASC']],
    });
    return items.map((item) => {
      const json: any = item.toJSON();
      json.evidenceFiles = (json.evidenceFiles || []).map(
        ({ filePath: _path, storedFilename: _stored, storageKey: _key, ...safe }: any) => safe,
      );
      if (json.currentStatusDescription) json.currentStatusDescription = decrypt(json.currentStatusDescription);
      json.selfReview = Boolean(item.reviewedBy && item.reviewedBy === item.assignedTo);
      return json;
    });
  }

  async saveReview(
    itemId: string,
    data: { complianceStatus: ComplianceStatus; return?: boolean },
    reviewerId: string,
  ) {
    const item = await QuestionItem.findByPk(itemId);
    if (!item) throw new Error('评估单元不存在');
    if (item.workflowStatus !== EvaluationWorkflowStatus.SUBMITTED) throw new Error('只有已提交评估单元可以复核');
    item.complianceStatus = data.return ? ComplianceStatus.NOT_ASSESSED : data.complianceStatus;
    item.workflowStatus = data.return ? EvaluationWorkflowStatus.RETURNED : EvaluationWorkflowStatus.REVIEWED;
    item.reviewedBy = reviewerId;
    item.reviewedAt = new Date();
    item.lockVersion += 1;
    await item.save();
    return item;
  }

  async returnTask(taskId: string, reason: string, userId: string) {
    const task = await AuditTask.findByPk(taskId);
    if (!task) throw new Error('任务不存在');
    task.status = TaskStatus.RETURNED;
    task.returnReason = reason;
    await task.save();
    await auditLogService.log({
      userId,
      operationType: OperationType.UPDATE,
      resourceType: 'task',
      resourceId: taskId,
      success: true,
      operationDetails: `退回评估: ${reason}`,
    });
    return task;
  }

  async completeReview(taskId: string, userId: string) {
    const task = await AuditTask.findByPk(taskId);
    if (!task) throw new Error('任务不存在');
    const unreviewed = await QuestionItem.count({
      where: { taskId, workflowStatus: { [Op.ne]: EvaluationWorkflowStatus.REVIEWED } },
    });
    if (unreviewed > 0) throw new Error(`还有 ${unreviewed} 个评估单元尚未审阅`);
    task.status = TaskStatus.COMPLETED;
    task.reviewedAt = new Date();
    await task.save();
    await auditLogService.log({
      userId,
      operationType: OperationType.UPDATE,
      resourceType: 'task',
      resourceId: taskId,
      success: true,
      operationDetails: '完成评估审阅',
    });
    return task;
  }
}

export default new ReviewService();
