import cron from 'node-cron';
import { Op, QueryTypes } from 'sequelize';
import sequelize from '../config/database';
import {
  Asset,
  AssessmentPlan,
  AssessmentPlanExecution,
  AssessmentPlanExecutionStatus,
  Department,
  NotificationType,
  OperationType,
  QuestionTemplate,
  QuestionnaireTemplate,
} from '../models';
import { AppError } from '../utils/http';
import { pagination, parsePagination } from '../utils/pagination';
import cronSchedulerService from './account/cronScheduler.service';
import assessmentScopeService from './assessment-scope.service';
import auditLogService from './audit-log.service';
import notificationService from './notification.service';
import objectAccessService from './object-access.service';
import taskService from './task.service';

type RequestUser = NonNullable<Express.Request['user']>;

interface PlanInput {
  name: string;
  templateId: string;
  assessmentType: string;
  defaultDepartmentId: string;
  cronExpression: string;
  timeZone?: string;
  scopeSnapshot: Array<{ assetId: string }>;
  matrixSnapshot: Array<{
    controlPointId: string;
    assetId: string;
    assignedTo: string;
    responsibleDepartmentId: string;
  }>;
  enabled?: boolean;
}

class AssessmentPlanService {
  private async validate(input: PlanInput, user: RequestUser) {
    if (!input.name?.trim() || !cron.validate(input.cronExpression)) {
      throw new AppError(400, 'VALIDATION_ERROR', '计划名称或 Cron 表达式无效');
    }
    if (!input.scopeSnapshot?.length || !input.matrixSnapshot?.length) {
      throw new AppError(400, 'VALIDATION_ERROR', '计划必须保存资产范围和矩阵快照');
    }
    const assetIds = [...new Set(input.scopeSnapshot.map((entry) => entry.assetId))];
    const controlIds = [...new Set(input.matrixSnapshot.map((entry) => entry.controlPointId))];
    const [template, department, assets, controls] = await Promise.all([
      QuestionnaireTemplate.findByPk(input.templateId),
      Department.findOne({ where: { id: input.defaultDepartmentId, status: 'active' } }),
      Asset.findAll({
        where: {
          id: { [Op.in]: assetIds },
          status: 'active',
          ...(await objectAccessService.assetScope(user, 'read') as object),
        },
      }),
      QuestionTemplate.findAll({ where: { id: { [Op.in]: controlIds }, templateId: input.templateId } }),
    ]);
    if (!template || !department || assets.length !== assetIds.length || controls.length !== controlIds.length) {
      throw new AppError(404, 'NOT_FOUND', '计划引用的标准、部门、资产或控制项无效');
    }
    if (input.matrixSnapshot.some((entry) => !assetIds.includes(entry.assetId))) {
      throw new AppError(400, 'VALIDATION_ERROR', '矩阵引用了范围外资产');
    }
  }

  async list(query: Record<string, unknown>, user: RequestUser) {
    const { page, pageSize } = parsePagination(query as any);
    const where: any = await objectAccessService.assessmentPlanScope(user, 'read');
    if (query.enabled !== undefined) where.enabled = query.enabled === 'true';
    const { rows, count } = await AssessmentPlan.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { items: rows, pagination: pagination(page, pageSize, count) };
  }

  async detail(id: string, user: RequestUser) {
    const plan = await AssessmentPlan.findOne({
      where: { id, ...(await objectAccessService.assessmentPlanScope(user, 'read') as object) },
      include: [{ association: 'executions', limit: 20, order: [['triggerTime', 'DESC']] }],
    });
    if (!plan) throw new AppError(404, 'NOT_FOUND', '周期评估计划不存在');
    return plan;
  }

  async create(input: PlanInput, user: RequestUser) {
    await this.validate(input, user);
    const plan = await AssessmentPlan.create({
      ...input,
      name: input.name.trim(),
      timeZone: input.timeZone || 'Asia/Shanghai',
      enabled: input.enabled !== false,
      createdBy: user.userId,
    });
    if (plan.enabled) await cronSchedulerService.registerResourceJob('assessment_plan', plan.id, plan.cronExpression);
    await auditLogService.log({
      userId: user.userId,
      operationType: OperationType.CREATE,
      resourceType: 'assessment_plan',
      resourceId: plan.id,
      operationDetails: `创建周期评估计划 ${plan.name}`,
      success: true,
      departmentId: plan.defaultDepartmentId,
    });
    return plan;
  }

  async update(id: string, input: Partial<PlanInput>, user: RequestUser) {
    const plan = await objectAccessService.assessmentPlanOrNotFound(id, user, 'update');
    const merged = { ...plan.toJSON(), ...input } as PlanInput;
    await this.validate(merged, user);
    await plan.update({
      ...input,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      lockVersion: plan.lockVersion + 1,
    });
    if (plan.enabled) await cronSchedulerService.registerResourceJob('assessment_plan', plan.id, plan.cronExpression);
    else await cronSchedulerService.unregisterResourceJob('assessment_plan', plan.id);
    return plan;
  }

  async trigger(id: string, user: RequestUser) {
    await objectAccessService.assessmentPlanOrNotFound(id, user, 'execute');
    const key = `manual:${id}:${crypto.randomUUID()}`;
    return this.executeScheduled(id, key, `manual:${user.userId}`);
  }

  async executeScheduled(planId: string, idempotencyKey: string, workerId: string) {
    const plan = await AssessmentPlan.findByPk(planId);
    if (!plan || !plan.enabled) throw new AppError(404, 'NOT_FOUND', '周期评估计划不存在或已停用');
    const reservation = await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        'SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))',
        {
          replacements: { key: `assessment-plan:${idempotencyKey}` },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      const existing = await AssessmentPlanExecution.findOne({
        where: { idempotencyKey },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (existing) return { execution: existing, replayed: true };
      const execution = await AssessmentPlanExecution.create({
        planId,
        triggerTime: new Date(),
        idempotencyKey,
        workerId,
        status: AssessmentPlanExecutionStatus.RUNNING,
      }, { transaction });
      return { execution, replayed: false };
    });
    if (reservation.replayed) return reservation.execution;
    const execution = reservation.execution;
    try {
      const assetIds = plan.scopeSnapshot.map((entry: any) => entry.assetId);
      const activeCount = await Asset.count({ where: { id: { [Op.in]: assetIds }, status: 'active' } });
      if (activeCount !== assetIds.length) {
        await execution.update({
          status: AssessmentPlanExecutionStatus.REQUIRES_ATTENTION,
          errorMessage: '计划资产范围包含已归档或不存在的资产',
        });
        await notificationService.create({
          userId: plan.createdBy,
          taskId: null,
          type: NotificationType.ASSESSMENT_PLAN_ATTENTION,
          title: '周期评估计划需要处理',
          content: `${plan.name} 的资产范围已变化，请更新计划快照`,
        }).catch(() => undefined);
        return execution;
      }
      const internalUser = {
        userId: plan.createdBy,
        memberId: null,
        tenantId: null,
        roleIds: [],
        identitySessionVersion: 0,
        memberSessionVersion: 0,
        isGlobalAdmin: true,
        permissions: {},
        permissionScopes: {},
        departmentIds: [plan.defaultDepartmentId],
        primaryDepartmentId: plan.defaultDepartmentId,
      } as any;
      const task = await taskService.createTask({
        templateId: plan.templateId,
        assessmentType: plan.assessmentType,
        name: `${plan.name} ${new Date().toISOString().slice(0, 10)}`,
        assessmentTarget: plan.name,
        departmentId: plan.defaultDepartmentId,
        createdBy: plan.createdBy,
      });
      await assessmentScopeService.replaceAssets(task.id, assetIds, internalUser);
      await assessmentScopeService.replaceMatrix(task.id, plan.matrixSnapshot as any, internalUser);
      await execution.update({
        taskId: task.id,
        status: AssessmentPlanExecutionStatus.SUCCESS,
        errorMessage: null,
      });
      await notificationService.create({
        userId: plan.createdBy,
        taskId: task.id,
        type: NotificationType.TASK_ASSIGNED,
        title: '周期评估草稿已创建',
        content: `${plan.name} 已按快照创建草稿，请确认范围和人员后发布`,
      }).catch(() => undefined);
      return execution;
    } catch (error) {
      await execution.update({
        status: AssessmentPlanExecutionStatus.FAILED,
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : '计划执行失败',
      });
      throw error;
    }
  }
}

export default new AssessmentPlanService();
