import { Op } from 'sequelize';
import crypto from 'crypto';
import {
  AccountAuditTask,
  ScheduleType,
  TaskStatus,
  TaskExecution,
  ExecutionStatus,
  TriggerType,
  ExecutionPhase,
  AccountData,
  DataTier,
  ProblemAccount,
  ProblemStatus,
  AuditRule,
} from '../../models/account';
import DataSource, { DataSourceStatus } from '../../models/account/DataSource';
import ruleEngineService from './ruleEngine.service';
import cronSchedulerService from './cronScheduler.service';
import { v4 as uuidv4 } from 'uuid';
import auditLogService from '../audit-log.service';
import { OperationType } from '../../models';

interface ListQuery {
  page?: number;
  pageSize?: number;
  status?: TaskStatus;
  scheduleType?: ScheduleType;
  search?: string;
}

interface CreateTaskInput {
  name: string;
  sourceId: string;
  selectedRules: string[];
  scheduleType: ScheduleType;
  scheduleConfig?: object;
}

interface UpdateTaskInput {
  name?: string;
  selectedRules?: string[];
  scheduleType?: ScheduleType;
  scheduleConfig?: object;
  status?: TaskStatus;
}

interface TaskTenantContext {
  tenantId: string | null;
  schemaName: string;
}

const PUBLIC_TASK_CONTEXT: TaskTenantContext = { tenantId: null, schemaName: 'public' };

class AuditTaskService {
  /**
   * 分页列出审计任务
   */
  async listTasks(query: ListQuery) {
    const { page = 1, pageSize = 20, status, scheduleType, search } = query;
    const where: any = {};

    if (status) where.status = status;
    if (scheduleType) where.scheduleType = scheduleType;
    if (search) {
      where.name = { [Op.iLike]: `%${search}%` };
    }

    const { count, rows } = await AccountAuditTask.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    // 补充数据源名称
    const items = await Promise.all(
      rows.map(async (t) => {
        const json: any = t.toJSON();
        try {
          const ds = await DataSource.findByPk(t.sourceId, { attributes: ['name'] });
          json.sourceName = ds?.name || '未知数据源';
        } catch {
          json.sourceName = '未知数据源';
        }
        return json;
      }),
    );

    return {
      items,
      pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
    };
  }

  /**
   * 获取单个任务
   */
  async getTask(id: string) {
    const task = await AccountAuditTask.findByPk(id);
    if (!task) throw new Error('审计任务不存在');

    const json: any = task.toJSON();
    try {
      const ds = await DataSource.findByPk(task.sourceId, { attributes: ['name'] });
      json.sourceName = ds?.name || '未知数据源';
    } catch {
      json.sourceName = '未知数据源';
    }

    return json;
  }

  /**
   * 创建任务
   */
  async createTask(data: CreateTaskInput, userId?: string, tenantContext: TaskTenantContext = PUBLIC_TASK_CONTEXT) {
    const ds = await DataSource.findByPk(data.sourceId);
    if (!ds) throw new Error('数据源不存在');
    if (ds.status === DataSourceStatus.INACTIVE) throw new Error('数据源已停用，无法创建任务');

    // 验证规则都存在
    if (data.selectedRules.length > 0) {
      const ruleCount = await AuditRule.count({
        where: { id: { [Op.in]: data.selectedRules } },
      });
      if (ruleCount !== data.selectedRules.length) {
        throw new Error('部分选定的规则不存在');
      }
    }

    const task = await AccountAuditTask.create({
      name: data.name,
      sourceId: data.sourceId,
      selectedRules: data.selectedRules,
      scheduleType: data.scheduleType,
      scheduleConfig: data.scheduleConfig || null,
      status: TaskStatus.ACTIVE,
      lastExecTime: null,
      lastExecResult: null,
      createdBy: userId || null,
    } as any);

    // Register cron job for non-MANUAL tasks
    if (task.scheduleType !== ScheduleType.MANUAL && task.status === TaskStatus.ACTIVE) {
      await cronSchedulerService.registerJob(task.id, task.scheduleType, task.scheduleConfig as any, tenantContext);
    }

    if (userId) {
      await auditLogService.log({
        userId,
        operationType: OperationType.CREATE,
        resourceType: 'task',
        resourceId: task.id,
        operationDetails: `创建审计任务: ${data.name}`,
        success: true,
      });
    }

    return task.toJSON();
  }

  /**
   * 更新任务
   */
  async updateTask(id: string, data: UpdateTaskInput, userId?: string, tenantContext: TaskTenantContext = PUBLIC_TASK_CONTEXT) {
    const task = await AccountAuditTask.findByPk(id);
    if (!task) throw new Error('审计任务不存在');

    const updates: any = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.scheduleType !== undefined) updates.scheduleType = data.scheduleType;
    if (data.scheduleConfig !== undefined) updates.scheduleConfig = data.scheduleConfig;
    if (data.status !== undefined) updates.status = data.status;

    if (data.selectedRules !== undefined) {
      const ruleCount = await AuditRule.count({
        where: { id: { [Op.in]: data.selectedRules } },
      });
      if (ruleCount !== data.selectedRules.length) {
        throw new Error('部分选定的规则不存在');
      }
      updates.selectedRules = data.selectedRules;
    }

    await task.update(updates);

    // Re-register cron job based on new schedule
    const updated = await task.reload();
    if (updated.scheduleType !== ScheduleType.MANUAL && updated.status === TaskStatus.ACTIVE) {
      await cronSchedulerService.registerJob(updated.id, updated.scheduleType, updated.scheduleConfig as any, tenantContext);
    } else {
      await cronSchedulerService.unregisterJob(updated.id, tenantContext);
    }

    if (userId) {
      await auditLogService.log({
        userId,
        operationType: OperationType.UPDATE,
        resourceType: 'task',
        resourceId: id,
        operationDetails: `更新审计任务: ${updated.name}`,
        success: true,
      });
    }

    return updated.toJSON();
  }

  /**
   * 删除任务
   */
  async deleteTask(id: string, userId?: string, tenantContext: TaskTenantContext = PUBLIC_TASK_CONTEXT) {
    const task = await AccountAuditTask.findByPk(id);
    if (!task) throw new Error('审计任务不存在');

    // Unregister cron job
    await cronSchedulerService.unregisterJob(id, tenantContext);

    // 删除执行记录
    await TaskExecution.destroy({ where: { taskId: id } });
    // 删除关联的问题账户
    await ProblemAccount.destroy({ where: { taskId: id } });
    await task.destroy();

    if (userId) {
      await auditLogService.log({
        userId,
        operationType: OperationType.DELETE,
        resourceType: 'task',
        resourceId: id,
        operationDetails: `删除审计任务: ${task.name}`,
        success: true,
      });
    }
  }

  // ==================== 任务执行 ====================

  /**
   * 执行审计任务（通过 cron 调度触发，triggerType=SCHEDULED，无需 userId）
   */
  async executeTaskScheduled(id: string, idempotencyKey: string, attempt = 1, maxAttempts = 3) {
    return this.executeTaskInternal(id, undefined, TriggerType.SCHEDULED, idempotencyKey, attempt, maxAttempts);
  }

  /**
   * 执行审计任务（手动触发，triggerType=MANUAL）
   */
  async executeTask(id: string, userId: string, idempotencyKey?: string) {
    const key = idempotencyKey || `manual:${id}:${crypto.randomUUID()}`;
    return this.executeTaskInternal(id, userId, TriggerType.MANUAL, key, 1, 1);
  }

  /**
   * 执行审计任务：完整的执行流水线
   */
  private async executeTaskInternal(
    id: string,
    userId: string | undefined,
    triggerType: TriggerType,
    idempotencyKey: string,
    attempt: number,
    maxAttempts: number,
  ) {
    const task = await AccountAuditTask.findByPk(id);
    if (!task) throw new Error('审计任务不存在');

    const priorExecution = await TaskExecution.findOne({ where: { idempotencyKey } });
    if (priorExecution) {
      return {
        executionId: priorExecution.id,
        status: priorExecution.status,
        accountsProcessed: priorExecution.accountsProcessed,
        problemsFound: priorExecution.problemsFound,
        idempotentReplay: true,
      };
    }

    // 并发保护：检查是否有正在运行的执行
    const runningExecution = await TaskExecution.findOne({
      where: { taskId: id, status: ExecutionStatus.RUNNING },
    });
    if (runningExecution) {
      throw new Error('该任务正在执行中，请等待当前执行完成');
    }

    // 检查数据源是否已停用
    const ds = await DataSource.findByPk(task.sourceId);
    if (!ds) throw new Error('关联的数据源不存在');
    if (ds.status === DataSourceStatus.INACTIVE) throw new Error('关联的数据源已停用，无法执行任务');

    // 生成批次ID
    const batchId = uuidv4();

    // 创建执行记录
    let execution: TaskExecution;
    try {
      execution = await TaskExecution.create({
        taskId: id,
        status: ExecutionStatus.RUNNING,
        currentPhase: ExecutionPhase.SYNCING,
        phaseProgress: 0,
        startTime: new Date(),
        heartbeatAt: new Date(),
        triggerType,
        triggeredBy: userId || null,
        attempt,
        maxAttempts,
        idempotencyKey,
      } as any);
    } catch (error: any) {
      if (error?.name === 'SequelizeUniqueConstraintError') {
        throw new Error('该任务正在执行中，或相同幂等请求已被受理');
      }
      throw error;
    }

    try {
      // === 阶段1: 同步数据 ===
      await execution.update({ currentPhase: ExecutionPhase.SYNCING, phaseProgress: 10, heartbeatAt: new Date() });

      // 检查是否需要同步（如果数据源上次同步时间较久或没有HOT数据）
      const hotCount = await AccountData.count({
        where: { sourceId: task.sourceId, dataTier: DataTier.HOT },
      });

      if (hotCount === 0) {
        // 没有HOT数据，不需要同步 -> 这通常是数据还未导入的情况
        // 实际生产中这里会触发数据导入，但这里我们只记录
      }

      // === 阶段2: 字段映射 ===
      await execution.update({ currentPhase: ExecutionPhase.MAPPING, phaseProgress: 30, heartbeatAt: new Date() });

      // === 阶段3: 规则匹配 ===
      await execution.update({ currentPhase: ExecutionPhase.MATCHING, phaseProgress: 50, heartbeatAt: new Date() });

      // 查询本数据源的 HOT 数据
      const hotAccounts = await AccountData.findAll({
        where: { sourceId: task.sourceId, dataTier: DataTier.HOT },
      });

      const accountIds = hotAccounts.map(a => a.accountId);

      // 获取启用的规则
      const ruleIds = task.selectedRules.length > 0
        ? task.selectedRules
        : (await AuditRule.findAll({
            where: { isActive: true },
            attributes: ['id'],
          })).map(r => r.id);

      if (ruleIds.length === 0) {
        throw new Error('没有可用的审计规则，请先启用规则或将规则关联到任务');
      }

      // 批量评估
      const evaluationResults = await ruleEngineService.evaluateBatch(accountIds, ruleIds);
      const matchedResults = evaluationResults.filter(r => r.matched);

      // === 阶段4: 去重 & 自动解决 ===
      await execution.update({ currentPhase: ExecutionPhase.SAVING, phaseProgress: 80, heartbeatAt: new Date() });

      // 4a. 去重：accountId + ruleId 唯一
      const newProblems = new Map<string, typeof matchedResults[0]>();
      for (const result of matchedResults) {
        const key = `${result.accountId}::${result.ruleId}`;
        if (!newProblems.has(key)) {
          newProblems.set(key, result);
        }
      }

      // 4b. 查询本任务上一批次的问题（用于自动关闭，仅本任务范围）
      const previousProblems = await ProblemAccount.findAll({
        where: {
          taskId: id,
          status: {
            [Op.in]: [ProblemStatus.PENDING, ProblemStatus.PROCESSING],
          },
        },
      });

      // 4c. 自动解决：上一批次中存在但本次不再触发的问题 → AUTO_RESOLVED
      const currentProblemKeys = new Set(newProblems.keys());
      let autoResolvedCount = 0;

      for (const prev of previousProblems) {
        const key = `${prev.accountId}::${prev.ruleId}`;
        if (!currentProblemKeys.has(key)) {
          await prev.update({
            status: ProblemStatus.AUTO_RESOLVED,
            resolvedAt: new Date(),
            resolutionNotes: '本轮审计中该问题不再触发，自动关闭',
          });
          autoResolvedCount++;
        }
      }

      // 4d. 跨任务去重 & 保存新问题
      // 4d.1 查询跨任务中已存在的相同 accountId+ruleId 问题
      const matchedAccountIds = [...newProblems.values()].map(r => r.accountId);
      const matchedRuleIds = [...new Set([...newProblems.values()].map(r => r.ruleId))];
      const crossTaskProblems = matchedAccountIds.length > 0 ? await ProblemAccount.findAll({
        where: {
          taskId: { [Op.ne]: id },
          accountId: { [Op.in]: matchedAccountIds },
          ruleId: { [Op.in]: matchedRuleIds },
          status: { [Op.in]: [ProblemStatus.PENDING, ProblemStatus.PROCESSING] },
        },
      }) : [];

      // 4d.2 构建本任务已存在的 key 集合 & crossTask 索引
      const sameTaskKeys = new Set(
        previousProblems.map(p => `${p.accountId}::${p.ruleId}`),
      );
      const crossTaskKeyMap = new Map<string, ProblemAccount>();
      for (const cp of crossTaskProblems) {
        crossTaskKeyMap.set(`${cp.accountId}::${cp.ruleId}`, cp);
      }

      const now = new Date();
      let newProblemCount = 0;
      let skippedSameTask = 0;
      let skippedCrossTask = 0;

      for (const [key, result] of newProblems) {
        // 本任务已存在 → 更新 lastSeenAt
        if (sameTaskKeys.has(key)) {
          skippedSameTask++;
          const match = previousProblems.find(p => `${p.accountId}::${p.ruleId}` === key);
          if (match) {
            await match.update({ lastSeenAt: now });
          }
          continue;
        }

        // 跨任务已存在 → 更新 lastSeenAt 到已有记录
        const crossMatch = crossTaskKeyMap.get(key);
        if (crossMatch) {
          skippedCrossTask++;
          await crossMatch.update({ lastSeenAt: now });
          continue;
        }

        // 全新问题 → 创建
        await ProblemAccount.create({
          taskId: id,
          accountDataId: result.accountDataId,
          ruleId: result.ruleId,
          accountId: result.accountId,
          problemDescription: `[${result.ruleName}] ${result.description}`,
          severity: result.severity,
          status: ProblemStatus.PENDING,
          firstDetectedAt: now,
          lastSeenAt: now,
          auditBatchId: batchId,
        } as any);
        newProblemCount++;
      }

      // === 完成 ===
      const endTime = new Date();
      const lastExecResult = {
        batchId,
        accountsProcessed: accountIds.length,
        problemsFound: newProblems.size,
        heartbeatAt: endTime,
        newProblems: newProblemCount,
        autoResolved: autoResolvedCount,
        skippedSameTask,
        skippedCrossTask,
        runAt: endTime.toISOString(),
      };

      await execution.update({
        status: ExecutionStatus.SUCCESS,
        currentPhase: null,
        phaseProgress: 100,
        endTime,
        accountsProcessed: accountIds.length,
        problemsFound: newProblems.size,
      });

      await task.update({
        lastExecTime: endTime,
        lastExecResult: lastExecResult as any,
      });

      if (userId) {
        await auditLogService.log({
          userId,
          operationType: OperationType.UPDATE,
          resourceType: 'task',
          resourceId: id,
          operationDetails: `执行审计任务，发现 ${newProblems.size} 个问题`,
          success: true,
        });
      }

      return {
        executionId: execution.id,
        status: 'SUCCESS',
        ...lastExecResult,
      };
    } catch (error: any) {
      // 执行失败
      await execution.update({
        status: ExecutionStatus.FAILED,
        currentPhase: null,
        phaseProgress: 0,
        endTime: new Date(),
        errorMessage: error.message,
        heartbeatAt: new Date(),
      });

      throw error;
    }
  }

  /**
   * 获取任务的执行历史
   */
  async getExecutionHistory(taskId: string, query?: { page?: number; pageSize?: number }) {
    const page = query?.page || 1;
    const pageSize = query?.pageSize || 20;

    const { count, rows } = await TaskExecution.findAndCountAll({
      where: { taskId },
      order: [['startTime', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return {
      items: rows.map(r => r.toJSON()),
      pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
    };
  }
}

export default new AuditTaskService();
