import { Op } from 'sequelize';
import {
  AuditTask,
  AnswerStatus,
  ComplianceStatus,
  EvaluationWorkflowStatus,
  OperationType,
  QuestionItem,
  TaskStatus,
} from '../models';
import { AppError } from '../utils/http';
import { decrypt, encrypt } from '../utils/crypto';
import { pagination, parsePagination } from '../utils/pagination';
import auditLogService from './audit-log.service';
import notificationService from './notification.service';
import objectAccessService from './object-access.service';

type RequestUser = NonNullable<Express.Request['user']>;

class EvaluationService {
  private safe(item: QuestionItem): Record<string, unknown> {
    const json: any = item.toJSON();
    if (json.currentStatusDescription) json.currentStatusDescription = decrypt(json.currentStatusDescription);
    json.evidenceFiles = (json.evidenceFiles || [])
      .filter((file: any) => file.status === 'active')
      .map(({ filePath: _path, storageKey: _key, storedFilename: _stored, ...file }: any) => file);
    json.selfReview = Boolean(item.reviewedBy && item.reviewedBy === item.assignedTo);
    return json;
  }

  async list(taskId: string, query: Record<string, unknown>, user: RequestUser) {
    await objectAccessService.taskOrNotFound(taskId, user);
    const { page, pageSize } = parsePagination(query as any);
    const where: any = { taskId, ...(await objectAccessService.evaluationScope(user) as object) };
    if (query.assetId) where.assetId = query.assetId;
    if (query.controlPointId) where.templateQuestionId = query.controlPointId;
    if (query.workflowStatus) where.workflowStatus = query.workflowStatus;
    if (query.complianceStatus) where.complianceStatus = query.complianceStatus;
    const { rows, count } = await QuestionItem.findAndCountAll({
      where,
      include: [
        { association: 'asset' },
        { association: 'evidenceFiles', where: { status: 'active' }, required: false },
      ],
      order: [['sequenceNumber', 'ASC'], ['assetId', 'ASC']],
      distinct: true,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { items: rows.map((row) => this.safe(row)), pagination: pagination(page, pageSize, count) };
  }

  async detail(id: string, user: RequestUser) {
    await objectAccessService.evaluationOrNotFound(id, user);
    const item = await QuestionItem.findByPk(id, {
      include: [
        { association: 'asset' },
        { association: 'task' },
        { association: 'evidenceFiles', where: { status: 'active' }, required: false },
      ],
    });
    if (!item) throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
    return this.safe(item);
  }

  async answer(id: string, description: string, lockVersion: number | undefined, user: RequestUser) {
    const item = await objectAccessService.evaluationOrNotFound(id, user, 'answer');
    if (item.assignedTo !== user.userId && !user.isGlobalAdmin
      && user.permissionScopes?.evaluations?.answer !== 'all') {
      throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
    }
    if ([EvaluationWorkflowStatus.SUBMITTED, EvaluationWorkflowStatus.REVIEWED].includes(item.workflowStatus)) {
      throw new AppError(409, 'CONFLICT', '已提交或已审阅的评估单元不能修改');
    }
    if (lockVersion !== undefined && item.lockVersion !== lockVersion) {
      throw new AppError(409, 'CONFLICT', '评估单元已被其他操作更新，请刷新后重试');
    }
    await item.update({
      currentStatusDescription: description?.trim() ? encrypt(description.trim()) : '',
      answerStatus: description?.trim() ? AnswerStatus.ANSWERED : AnswerStatus.PENDING,
      workflowStatus: description?.trim() ? EvaluationWorkflowStatus.IN_PROGRESS : EvaluationWorkflowStatus.PENDING,
      answeredAt: new Date(),
      lockVersion: item.lockVersion + 1,
    });
    const task = await AuditTask.findByPk(item.taskId);
    if (task && task.status === TaskStatus.ASSIGNED) await task.update({ status: TaskStatus.IN_PROGRESS });
    await auditLogService.log({
      userId: user.userId,
      operationType: OperationType.UPDATE,
      resourceType: 'control_evaluation',
      resourceId: item.id,
      operationDetails: '保存评估单元回答',
      success: true,
      departmentId: item.responsibleDepartmentId || undefined,
    });
    return this.detail(id, user);
  }

  async submit(id: string, user: RequestUser) {
    const item = await objectAccessService.evaluationOrNotFound(id, user, 'submit');
    if (item.assignedTo !== user.userId && !user.isGlobalAdmin
      && user.permissionScopes?.evaluations?.submit !== 'all') {
      throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
    }
    if (!item.currentStatusDescription) throw new AppError(400, 'VALIDATION_ERROR', '请先填写现状说明');
    if (item.workflowStatus === EvaluationWorkflowStatus.REVIEWED) {
      throw new AppError(409, 'CONFLICT', '已审阅的评估单元不能重复提交');
    }
    await item.update({
      workflowStatus: EvaluationWorkflowStatus.SUBMITTED,
      submittedAt: new Date(),
      lockVersion: item.lockVersion + 1,
    });
    const remaining = await QuestionItem.count({
      where: { taskId: item.taskId, workflowStatus: { [Op.ne]: EvaluationWorkflowStatus.SUBMITTED } },
    });
    const task = await AuditTask.findByPk(item.taskId);
    if (task && remaining === 0) {
      await task.update({ status: TaskStatus.SUBMITTED, submittedAt: new Date() });
      if (task.reviewerId) {
        await notificationService.notifyTaskSubmitted(task.reviewerId, task.id, task.name || task.assessmentTarget);
      }
    }
    await auditLogService.log({
      userId: user.userId,
      operationType: OperationType.UPDATE,
      resourceType: 'control_evaluation',
      resourceId: item.id,
      operationDetails: '提交评估单元复核',
      success: true,
      departmentId: item.responsibleDepartmentId || undefined,
    });
    return this.detail(id, user);
  }

  async review(
    id: string,
    input: { complianceStatus: ComplianceStatus; comment?: string; return?: boolean },
    user: RequestUser,
  ) {
    const item = await objectAccessService.evaluationOrNotFound(id, user, 'review');
    if (item.workflowStatus !== EvaluationWorkflowStatus.SUBMITTED) {
      throw new AppError(409, 'CONFLICT', '只有已提交的评估单元可以复核');
    }
    if (!Object.values(ComplianceStatus).includes(input.complianceStatus)) {
      throw new AppError(400, 'VALIDATION_ERROR', '符合性结论无效');
    }
    if (input.return) {
      await item.update({
        workflowStatus: EvaluationWorkflowStatus.RETURNED,
        complianceStatus: ComplianceStatus.NOT_ASSESSED,
        reviewedBy: user.userId,
        reviewedAt: new Date(),
        lockVersion: item.lockVersion + 1,
      });
    } else {
      await item.update({
        workflowStatus: EvaluationWorkflowStatus.REVIEWED,
        complianceStatus: input.complianceStatus,
        reviewedBy: user.userId,
        reviewedAt: new Date(),
        lockVersion: item.lockVersion + 1,
      });
    }
    const task = await AuditTask.findByPk(item.taskId);
    if (task && task.status === TaskStatus.SUBMITTED) await task.update({ status: TaskStatus.UNDER_REVIEW });
    await auditLogService.log({
      userId: user.userId,
      operationType: OperationType.UPDATE,
      resourceType: 'control_evaluation',
      resourceId: id,
      operationDetails: `${input.return ? '退回' : '复核'}评估单元，自审=${item.assignedTo === user.userId}`,
      success: true,
      departmentId: item.responsibleDepartmentId || undefined,
    });
    return this.detail(id, user);
  }
}

export default new EvaluationService();
