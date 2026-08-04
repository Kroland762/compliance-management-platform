import { Op, Transaction } from 'sequelize';
import sequelize from '../config/database';
import {
  Asset,
  AssessmentAsset,
  AssessmentControlAsset,
  AuditTask,
  Department,
  EvaluationWorkflowStatus,
  AnswerStatus,
  OperationType,
  QuestionItem,
  QuestionTemplate,
  TaskStatus,
  TenantMember,
  TenantMemberStatus,
} from '../models';
import { AppError } from '../utils/http';
import auditLogService from './audit-log.service';
import notificationService from './notification.service';
import objectAccessService from './object-access.service';
import { assessmentPublishDuration } from './metrics.service';

type RequestUser = NonNullable<Express.Request['user']>;

interface MatrixEntry {
  controlPointId: string;
  assetId: string;
  assignedTo?: string | null;
  responsibleDepartmentId?: string | null;
}

class AssessmentScopeService {
  private async editableTask(taskId: string, user: RequestUser): Promise<AuditTask> {
    const task = await objectAccessService.taskOrNotFound(taskId, user, 'update');
    if (![TaskStatus.DRAFT, TaskStatus.CONFIGURING].includes(task.status)) {
      throw new AppError(409, 'CONFLICT', '只有草稿或配置中的评估可以调整范围');
    }
    return task;
  }

  async getAssets(taskId: string, user: RequestUser) {
    await objectAccessService.taskOrNotFound(taskId, user);
    return AssessmentAsset.findAll({
      where: { taskId, scopeStatus: 'included' },
      include: [{ association: 'asset' }],
      order: [['assetCodeSnapshot', 'ASC']],
    });
  }

  async replaceAssets(taskId: string, assetIds: string[], user: RequestUser) {
    const task = await this.editableTask(taskId, user);
    const uniqueIds = [...new Set(assetIds || [])];
    if (!uniqueIds.length) throw new AppError(400, 'VALIDATION_ERROR', '至少选择一个评估资产');
    const assets = await Asset.findAll({ where: { id: { [Op.in]: uniqueIds }, status: 'active' } });
    if (assets.length !== uniqueIds.length) throw new AppError(404, 'NOT_FOUND', '评估资产不存在或已归档');

    await sequelize.transaction(async (transaction) => {
      await AssessmentControlAsset.destroy({ where: { taskId }, transaction });
      await AssessmentAsset.destroy({ where: { taskId }, transaction });
      await AssessmentAsset.bulkCreate(assets.map((asset) => ({
        taskId,
        assetId: asset.id,
        scopeStatus: 'included',
        assetCodeSnapshot: asset.code,
        assetNameSnapshot: asset.name,
        assetTypeSnapshot: asset.assetType,
        criticalitySnapshot: asset.criticality,
        ownerDepartmentIdSnapshot: asset.ownerDepartmentId,
        addedBy: user.userId,
      })), { transaction });
      await task.update({ status: TaskStatus.CONFIGURING }, { transaction });
    });
    await auditLogService.log({
      userId: user.userId,
      operationType: OperationType.UPDATE,
      resourceType: 'assessment_scope',
      resourceId: taskId,
      operationDetails: `设置评估资产范围，共 ${assets.length} 个资产`,
      success: true,
      departmentId: task.departmentId,
    });
    return this.getAssets(taskId, user);
  }

  async getMatrix(taskId: string, user: RequestUser) {
    await objectAccessService.taskOrNotFound(taskId, user);
    return AssessmentControlAsset.findAll({
      where: { taskId },
      include: [
        { association: 'controlPoint' },
        { association: 'asset' },
      ],
      order: [['controlPointId', 'ASC'], ['assetId', 'ASC']],
    });
  }

  private async validateMatrix(
    task: AuditTask,
    entries: MatrixEntry[],
    transaction?: Transaction,
  ): Promise<MatrixEntry[]> {
    if (!Array.isArray(entries) || !entries.length) {
      throw new AppError(400, 'VALIDATION_ERROR', '控制项资产矩阵不能为空');
    }
    const normalized = entries.map((entry) => ({
      controlPointId: entry.controlPointId,
      assetId: entry.assetId,
      assignedTo: entry.assignedTo || task.assignedTo || null,
      responsibleDepartmentId: entry.responsibleDepartmentId || task.departmentId,
    }));
    const keys = new Set(normalized.map((entry) => `${entry.controlPointId}:${entry.assetId}`));
    if (keys.size !== normalized.length) throw new AppError(409, 'CONFLICT', '矩阵中存在重复的控制项资产组合');

    // A Sequelize transaction owns one PostgreSQL client; run its queries
    // sequentially to remain compatible with pg 9 (which rejects overlapping
    // client.query calls).
    const controls = await QuestionTemplate.findAll({
      where: {
        id: { [Op.in]: [...new Set(normalized.map((entry) => entry.controlPointId))] },
        templateId: task.templateId,
      },
      transaction,
    });
    const scopedAssets = await AssessmentAsset.findAll({
      where: {
        taskId: task.id,
        assetId: { [Op.in]: [...new Set(normalized.map((entry) => entry.assetId))] },
        scopeStatus: 'included',
      },
      transaction,
    });
    const departments = await Department.findAll({
      where: {
        id: { [Op.in]: [...new Set(normalized.map((entry) => entry.responsibleDepartmentId!))] },
        status: 'active',
      },
      transaction,
    });
    if (controls.length !== new Set(normalized.map((entry) => entry.controlPointId)).size) {
      throw new AppError(404, 'NOT_FOUND', '矩阵包含不属于当前标准的控制项');
    }
    if (scopedAssets.length !== new Set(normalized.map((entry) => entry.assetId)).size) {
      throw new AppError(404, 'NOT_FOUND', '矩阵包含不在评估范围内的资产');
    }
    if (departments.length !== new Set(normalized.map((entry) => entry.responsibleDepartmentId)).size) {
      throw new AppError(404, 'NOT_FOUND', '矩阵包含无效责任部门');
    }
    const assigneeIds = [...new Set(normalized.map((entry) => entry.assignedTo).filter(Boolean))] as string[];
    if (assigneeIds.length) {
      const count = await TenantMember.count({
        where: { userId: { [Op.in]: assigneeIds }, status: TenantMemberStatus.ACTIVE },
        transaction,
      });
      if (count !== assigneeIds.length) throw new AppError(404, 'NOT_FOUND', '矩阵包含无效责任人');
    }
    if (normalized.some((entry) => !entry.assignedTo)) {
      throw new AppError(400, 'VALIDATION_ERROR', '每个评估单元都必须指定责任人');
    }
    return normalized;
  }

  async replaceMatrix(taskId: string, entries: MatrixEntry[], user: RequestUser) {
    const task = await this.editableTask(taskId, user);
    const normalized = await this.validateMatrix(task, entries);
    await sequelize.transaction(async (transaction) => {
      await AssessmentControlAsset.destroy({ where: { taskId }, transaction });
      await AssessmentControlAsset.bulkCreate(normalized.map((entry) => ({
        taskId,
        controlPointId: entry.controlPointId,
        assetId: entry.assetId,
        assignedTo: entry.assignedTo!,
        responsibleDepartmentId: entry.responsibleDepartmentId!,
      })), { transaction });
      await task.update({ status: TaskStatus.CONFIGURING }, { transaction });
    });
    await auditLogService.log({
      userId: user.userId,
      operationType: OperationType.UPDATE,
      resourceType: 'control_asset_matrix',
      resourceId: taskId,
      operationDetails: `保存控制项资产矩阵，共 ${normalized.length} 个评估单元`,
      success: true,
      departmentId: task.departmentId,
    });
    return this.getMatrix(taskId, user);
  }

  async publish(taskId: string, user: RequestUser) {
    const stopTimer = assessmentPublishDuration.startTimer();
    try {
      const result = await sequelize.transaction(async (transaction) => {
      const task = await AuditTask.findByPk(taskId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!task) throw new AppError(404, 'NOT_FOUND', '评估不存在');
      await objectAccessService.taskOrNotFound(taskId, user, 'update');
      if (task.publishedAt) {
        return { task, created: 0, total: await QuestionItem.count({ where: { taskId }, transaction }) };
      }
      if (![TaskStatus.DRAFT, TaskStatus.CONFIGURING].includes(task.status)) {
        throw new AppError(409, 'CONFLICT', '当前评估状态不能发布');
      }
      const rows = await AssessmentControlAsset.findAll({ where: { taskId }, transaction });
      const normalized = await this.validateMatrix(task, rows.map((row) => row.toJSON()), transaction);
      const controlIds = [...new Set(normalized.map((row) => row.controlPointId))];
      const controls = await QuestionTemplate.findAll({
        where: { id: { [Op.in]: controlIds }, templateId: task.templateId },
        transaction,
      });
      const controlMap = new Map(controls.map((control) => [control.id, control]));
      const existing = await QuestionItem.count({ where: { taskId }, transaction });
      if (existing) throw new AppError(409, 'CONFLICT', '评估已存在单元，请勿重复发布');

      await QuestionItem.bulkCreate(normalized.map((row) => {
        const control = controlMap.get(row.controlPointId)!;
        return {
          taskId,
          templateQuestionId: control.id,
          assetId: row.assetId,
          sequenceNumber: control.sequenceNumber,
          controlDomain: control.controlDomain,
          controlPoint: control.controlPoint,
          referenceAnswer: control.referenceAnswer,
          historicalEvidencePath: control.historicalEvidencePath,
          responsibleDepartment: null,
          responsiblePerson: null,
          responsibleDepartmentId: row.responsibleDepartmentId!,
          currentStatusDescription: null,
          assignedTo: row.assignedTo!,
          answerStatus: AnswerStatus.PENDING,
          workflowStatus: EvaluationWorkflowStatus.PENDING,
        };
      }), { transaction });
      const assignees = [...new Set(normalized.map((row) => row.assignedTo!))];
      await task.update({
        status: TaskStatus.ASSIGNED,
        publishedAt: new Date(),
        assignedTo: assignees[0] || task.assignedTo,
        lockVersion: task.lockVersion + 1,
      }, { transaction });
      return { task, created: normalized.length, total: normalized.length, assignees };
      });

      for (const assignee of result.assignees || []) {
        await notificationService.notifyTaskAssigned(assignee, taskId, result.task.name || result.task.assessmentTarget);
      }
      await auditLogService.log({
        userId: user.userId,
        operationType: OperationType.UPDATE,
        resourceType: 'assessment',
        resourceId: taskId,
        operationDetails: `发布评估并生成 ${result.total} 个评估单元`,
        success: true,
        departmentId: result.task.departmentId,
      });
      stopTimer({ outcome: 'success' });
      return result;
    } catch (error) {
      stopTimer({ outcome: 'failure' });
      throw error;
    }
  }
}

export default new AssessmentScopeService();
