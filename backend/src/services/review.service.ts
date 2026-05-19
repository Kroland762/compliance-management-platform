import { QuestionItem, AuditTask, RiskRecord, TaskStatus, ComplianceStatus, RiskLevel, RemediationStatus, RiskStatus, AssessmentType, OperationType, AuditLog } from '../models';
import { decrypt } from '../utils/crypto';

class ReviewService {
  async getReviewData(taskId: string) {
    const items = await QuestionItem.findAll({
      where: { taskId },
      include: [{ association: 'evidenceFiles' }],
      order: [['sequenceNumber', 'ASC']],
    });
    return items.map(item => {
      const json = item.toJSON() as any;
      if (json.currentStatusDescription) {
        json.currentStatusDescription = decrypt(json.currentStatusDescription);
      }
      return json;
    });
  }

  async saveReview(itemId: string, data: {
    complianceStatus: ComplianceStatus;
    riskIdentification?: string;
    riskLevel?: RiskLevel;
    remediationMeasures?: string;
  }) {
    const item = await QuestionItem.findByPk(itemId);
    if (!item) throw new Error('问卷条目不存在');
    item.complianceStatus = data.complianceStatus;
    if (data.riskIdentification !== undefined) item.riskIdentification = data.riskIdentification || null;
    if (data.riskLevel !== undefined) item.riskLevel = data.riskLevel;
    if (data.remediationMeasures !== undefined) item.remediationMeasures = data.remediationMeasures || null;
    item.reviewedAt = new Date();
    await item.save();
    return item;
  }

  async returnTask(taskId: string, reason: string, userId: string) {
    const task = await AuditTask.findByPk(taskId);
    if (!task) throw new Error('任务不存在');
    task.status = TaskStatus.RETURNED;
    task.returnReason = reason;
    await task.save();

    await AuditLog.create({
      userId, operationType: OperationType.UPDATE, resourceType: 'task',
      resourceId: taskId, success: true,
      operationDetails: `退回任务: ${reason}`,
    } as any);

    return task;
  }

  async completeReview(taskId: string, userId: string) {
    const task = await AuditTask.findByPk(taskId);
    if (!task) throw new Error('任务不存在');

    const items = await QuestionItem.findAll({ where: { taskId } });
    const unreviewed = items.filter(i => !i.complianceStatus);
    if (unreviewed.length > 0) {
      throw new Error(`还有 ${unreviewed.length} 个问题尚未审阅`);
    }

    // Create RiskRecord for items with risk identified
    for (const item of items) {
      if (item.riskIdentification && item.riskLevel) {
        await RiskRecord.create({
          taskId, questionItemId: item.id,
          assessmentType: task.assessmentType,
          assessmentTarget: task.assessmentTarget,
          riskIdentification: item.riskIdentification,
          riskLevel: item.riskLevel,
          remediationMeasures: item.remediationMeasures || null,
          remediationStatus: RemediationStatus.NOT_REMEDIATED,
          riskStatus: RiskStatus.RISK_REDUCTION,
        } as any);
      }
    }

    task.status = TaskStatus.COMPLETED;
    task.reviewedAt = new Date();
    await task.save();

    await AuditLog.create({
      userId, operationType: OperationType.UPDATE, resourceType: 'task',
      resourceId: taskId, success: true,
      operationDetails: '完成审阅',
    } as any);

    return task;
  }
}

export default new ReviewService();
