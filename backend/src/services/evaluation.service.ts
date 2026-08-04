import { Op } from 'sequelize';
import sequelize from '../config/database';
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
import { assertLockVersion } from '../utils/optimistic-lock';

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

  async answer(id: string, description: string, lockVersion: number, user: RequestUser) {
    await objectAccessService.evaluationOrNotFound(id, user, 'answer');
    await sequelize.transaction(async (transaction) => {
      const item = await QuestionItem.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!item) throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      if (item.assignedTo !== user.userId && !user.isGlobalAdmin
        && user.permissionScopes?.evaluations?.answer !== 'all') {
        throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      }
      if ([EvaluationWorkflowStatus.SUBMITTED, EvaluationWorkflowStatus.REVIEWED].includes(item.workflowStatus)) {
        throw new AppError(409, 'CONFLICT', '已提交或已审阅的评估单元不能修改');
      }
      assertLockVersion(item.lockVersion, lockVersion);
      await item.update({
        currentStatusDescription: description?.trim() ? encrypt(description.trim()) : '',
        answerStatus: description?.trim() ? AnswerStatus.ANSWERED : AnswerStatus.PENDING,
        workflowStatus: description?.trim() ? EvaluationWorkflowStatus.IN_PROGRESS : EvaluationWorkflowStatus.PENDING,
        answeredAt: new Date(),
        lockVersion: item.lockVersion + 1,
      }, { transaction });
      const task = await AuditTask.findByPk(item.taskId, { transaction, lock: transaction.LOCK.UPDATE });
      if (task && task.status === TaskStatus.ASSIGNED) {
        await task.update({ status: TaskStatus.IN_PROGRESS }, { transaction });
      }
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'control_evaluation',
        resourceId: item.id,
        operationDetails: '保存评估单元回答',
        success: true,
        departmentId: item.responsibleDepartmentId,
      }, transaction);
    });
    return this.detail(id, user);
  }

  async submit(id: string, user: RequestUser, expectedLockVersion: number) {
    await objectAccessService.evaluationOrNotFound(id, user, 'submit');
    let reviewerNotification: { userId: string; taskId: string; name: string } | null = null;
    await sequelize.transaction(async (transaction) => {
      const item = await QuestionItem.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!item) throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      if (item.assignedTo !== user.userId && !user.isGlobalAdmin
        && user.permissionScopes?.evaluations?.submit !== 'all') {
        throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      }
      assertLockVersion(item.lockVersion, expectedLockVersion);
      if (!item.currentStatusDescription) throw new AppError(400, 'VALIDATION_ERROR', '请先填写现状说明');
      if (item.workflowStatus === EvaluationWorkflowStatus.REVIEWED) {
        throw new AppError(409, 'CONFLICT', '已审阅的评估单元不能重复提交');
      }
      await item.update({
        workflowStatus: EvaluationWorkflowStatus.SUBMITTED,
        submittedAt: new Date(),
        lockVersion: item.lockVersion + 1,
      }, { transaction });
      const remaining = await QuestionItem.count({
        where: {
          taskId: item.taskId,
          workflowStatus: { [Op.notIn]: [EvaluationWorkflowStatus.SUBMITTED, EvaluationWorkflowStatus.REVIEWED] },
        },
        transaction,
      });
      const task = await AuditTask.findByPk(item.taskId, { transaction, lock: transaction.LOCK.UPDATE });
      if (task && remaining === 0) {
        await task.update({ status: TaskStatus.SUBMITTED, submittedAt: new Date() }, { transaction });
        if (task.reviewerId) {
          reviewerNotification = {
            userId: task.reviewerId,
            taskId: task.id,
            name: task.name || task.assessmentTarget,
          };
        }
      }
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'control_evaluation',
        resourceId: item.id,
        operationDetails: '提交评估单元复核',
        success: true,
        departmentId: item.responsibleDepartmentId,
      }, transaction);
    });
    if (reviewerNotification) {
      const notice = reviewerNotification as { userId: string; taskId: string; name: string };
      await notificationService.notifyTaskSubmitted(notice.userId, notice.taskId, notice.name);
    }
    return this.detail(id, user);
  }

  async review(
    id: string,
    input: { complianceStatus: ComplianceStatus; comment?: string; return?: boolean },
    user: RequestUser,
    expectedLockVersion: number,
  ) {
    await objectAccessService.evaluationOrNotFound(id, user, 'review');
    if (!Object.values(ComplianceStatus).includes(input.complianceStatus)) {
      throw new AppError(400, 'VALIDATION_ERROR', '符合性结论无效');
    }
    await sequelize.transaction(async (transaction) => {
      const item = await QuestionItem.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!item) throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
      assertLockVersion(item.lockVersion, expectedLockVersion);
      if (item.workflowStatus !== EvaluationWorkflowStatus.SUBMITTED) {
        throw new AppError(409, 'CONFLICT', '只有已提交的评估单元可以复核');
      }
      await item.update(input.return ? {
        workflowStatus: EvaluationWorkflowStatus.RETURNED,
        complianceStatus: ComplianceStatus.NOT_ASSESSED,
        reviewedBy: user.userId,
        reviewedAt: new Date(),
        lockVersion: item.lockVersion + 1,
      } : {
        workflowStatus: EvaluationWorkflowStatus.REVIEWED,
        complianceStatus: input.complianceStatus,
        reviewedBy: user.userId,
        reviewedAt: new Date(),
        lockVersion: item.lockVersion + 1,
      }, { transaction });
      const task = await AuditTask.findByPk(item.taskId, { transaction, lock: transaction.LOCK.UPDATE });
      if (task && task.status === TaskStatus.SUBMITTED) {
        await task.update({ status: TaskStatus.UNDER_REVIEW }, { transaction });
      }
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'control_evaluation',
        resourceId: id,
        operationDetails: `${input.return ? '退回' : '复核'}评估单元，自审=${item.assignedTo === user.userId}`,
        success: true,
        departmentId: item.responsibleDepartmentId,
      }, transaction);
    });
    return this.detail(id, user);
  }
}

export default new EvaluationService();
