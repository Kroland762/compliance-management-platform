import cron from 'node-cron';
import os from 'os';
import { Op } from 'sequelize';
import sequelize from '../../config/database';
import { AccountAuditTask, ExecutionStatus, ScheduleType, TaskExecution, TaskStatus } from '../../models/account';
import { PersistentScheduleStatus, TaskSchedule, Tenant } from '../../models';
import { TenantStatus } from '../../models/Tenant';
import { runWithTenantContext, type TenantExecutionContext } from '../../middlewares/tenant';
import auditTaskService from './auditTask.service';

const TIMEZONE = process.env.TASK_SCHEDULER_TIMEZONE || 'Asia/Shanghai';
const STALE_LOCK_MS = Math.max(Number(process.env.TASK_SCHEDULER_STALE_LOCK_MS || 10 * 60 * 1000), 60_000);
const POLL_MS = Math.max(Number(process.env.TASK_SCHEDULER_POLL_MS || 5000), 1000);
const MAX_RETRIES = Math.max(Number(process.env.TASK_SCHEDULER_MAX_RETRIES || 3), 1);

export interface ScheduleTenantContext {
  tenantId: string | null;
  schemaName: string;
}

/** PostgreSQL-backed scheduler. Schedule state and leases survive restarts. */
class CronSchedulerService {
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private initialized = false;
  private readonly workerId = `${os.hostname()}:${process.pid}`;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await this.reconcileAllSchemas();
    await this.processDueSchedules();
    this.pollTimer = setInterval(() => {
      void this.processDueSchedules();
    }, POLL_MS);
    this.pollTimer.unref();
    console.log(`[TaskScheduler] persistent scheduler started as ${this.workerId}`);
  }

  buildCronExpression(scheduleType: ScheduleType, config?: Record<string, any> | null): string | null {
    const numberInRange = (value: unknown, fallback: number, min: number, max: number): number => {
      const number = value === undefined ? fallback : Number(value);
      if (!Number.isInteger(number) || number < min || number > max) throw new Error('任务调度参数无效');
      return number;
    };
    let expression: string | null = null;
    if (scheduleType === ScheduleType.DAILY) {
      expression = `${numberInRange(config?.minute, 0, 0, 59)} ${numberInRange(config?.hour, 0, 0, 23)} * * *`;
    } else if (scheduleType === ScheduleType.WEEKLY) {
      expression = `${numberInRange(config?.minute, 0, 0, 59)} ${numberInRange(config?.hour, 0, 0, 23)} * * ${numberInRange(config?.dayOfWeek, 1, 0, 6)}`;
    } else if (scheduleType === ScheduleType.MONTHLY) {
      expression = `${numberInRange(config?.minute, 0, 0, 59)} ${numberInRange(config?.hour, 0, 0, 23)} ${numberInRange(config?.dayOfMonth, 1, 1, 28)} * *`;
    } else if (scheduleType === ScheduleType.CRON) {
      expression = typeof config?.expression === 'string' ? config.expression.trim() : null;
    }
    if (!expression) return null;
    if (!cron.validate(expression)) throw new Error('Cron表达式无效');
    return expression;
  }

  async registerJob(
    taskId: string,
    scheduleType: ScheduleType,
    scheduleConfig?: Record<string, any> | null,
    tenant: ScheduleTenantContext = { tenantId: null, schemaName: 'public' },
  ): Promise<void> {
    const expression = this.buildCronExpression(scheduleType, scheduleConfig);
    if (!expression) {
      await this.unregisterJob(taskId, tenant);
      return;
    }
    const existing = await TaskSchedule.findOne({ where: { schemaName: tenant.schemaName, taskId } });
    const nextRunAt = existing?.cronExpression === expression && existing.nextRunAt
      ? existing.nextRunAt
      : this.calculateNextRun(expression);
    if (existing) {
      await existing.update({
        tenantId: tenant.tenantId,
        cronExpression: expression,
        timezone: TIMEZONE,
        status: PersistentScheduleStatus.ACTIVE,
        nextRunAt,
        lockedAt: null,
        lockedBy: null,
      });
      return;
    }
    await TaskSchedule.create({
      tenantId: tenant.tenantId,
      schemaName: tenant.schemaName,
      taskId,
      cronExpression: expression,
      timezone: TIMEZONE,
      status: PersistentScheduleStatus.ACTIVE,
      nextRunAt,
    });
  }

  async unregisterJob(
    taskId: string,
    tenant: ScheduleTenantContext = { tenantId: null, schemaName: 'public' },
  ): Promise<void> {
    await TaskSchedule.destroy({ where: { schemaName: tenant.schemaName, taskId } });
  }

  private calculateNextRun(expression: string): Date {
    const task = cron.createTask(expression, () => undefined, { timezone: TIMEZONE });
    try {
      const nextRun = task.getNextRun();
      if (!nextRun) throw new Error('无法计算下次执行时间');
      return nextRun;
    } finally {
      void task.destroy();
    }
  }

  private async reconcileAllSchemas(): Promise<void> {
    await this.reconcileSchema({ schema: 'public', tenantId: null });
    const tenants = await Tenant.findAll({ where: { status: TenantStatus.ACTIVE } });
    for (const tenant of tenants) {
      await this.reconcileSchema({ schema: tenant.schemaName, tenantId: tenant.id });
    }
  }

  private async reconcileSchema(context: TenantExecutionContext): Promise<void> {
    await runWithTenantContext(context, async () => {
      const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
      await TaskExecution.update({
        status: ExecutionStatus.FAILED,
        endTime: new Date(),
        errorMessage: 'Worker心跳超时，执行已自动回收',
      }, { where: { status: ExecutionStatus.RUNNING, heartbeatAt: { [Op.lt]: staleBefore } } });

      const tasks = await AccountAuditTask.findAll({
        where: { status: TaskStatus.ACTIVE, scheduleType: { [Op.ne]: ScheduleType.MANUAL } },
      });
      for (const task of tasks) {
        await this.registerJob(task.id, task.scheduleType, task.scheduleConfig as any, {
          tenantId: context.tenantId,
          schemaName: context.schema,
        });
      }
    });
  }

  private async claimDueSchedule(): Promise<TaskSchedule | null> {
    const transaction = await sequelize.transaction();
    try {
      const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
      const schedule = await TaskSchedule.findOne({
        where: {
          status: PersistentScheduleStatus.ACTIVE,
          nextRunAt: { [Op.lte]: new Date() },
          [Op.or]: [{ lockedAt: null }, { lockedAt: { [Op.lt]: staleBefore } }],
        },
        order: [['nextRunAt', 'ASC']],
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true,
      });
      if (!schedule) {
        await transaction.commit();
        return null;
      }
      await schedule.update({ lockedAt: new Date(), lockedBy: this.workerId }, { transaction });
      await transaction.commit();
      return schedule;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  private async processDueSchedules(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      for (;;) {
        const schedule = await this.claimDueSchedule();
        if (!schedule) break;
        await this.executeClaimedSchedule(schedule);
      }
    } catch (error: any) {
      console.error(`[TaskScheduler] poll failed: ${error.message}`);
    } finally {
      this.polling = false;
    }
  }

  private async executeClaimedSchedule(schedule: TaskSchedule): Promise<void> {
    const scheduledFor = new Date(schedule.nextRunAt);
    const attempt = schedule.failureCount + 1;
    const idempotencyKey = `schedule:${schedule.id}:${scheduledFor.toISOString()}:attempt:${attempt}`;
    try {
      await runWithTenantContext({ schema: schedule.schemaName, tenantId: schedule.tenantId }, () =>
        auditTaskService.executeTaskScheduled(schedule.taskId, idempotencyKey, attempt, MAX_RETRIES));
      await schedule.update({
        nextRunAt: this.calculateNextRun(schedule.cronExpression),
        lastRunAt: new Date(),
        failureCount: 0,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
      });
    } catch (error: any) {
      const failures = schedule.failureCount + 1;
      const exhausted = failures >= MAX_RETRIES;
      const retryDelayMs = Math.min(60_000 * (2 ** Math.max(failures - 1, 0)), 15 * 60_000);
      await schedule.update({
        nextRunAt: exhausted ? this.calculateNextRun(schedule.cronExpression) : new Date(Date.now() + retryDelayMs),
        failureCount: exhausted ? 0 : failures,
        lastError: String(error.message || error).slice(0, 2000),
        lockedAt: null,
        lockedBy: null,
      });
    }
  }

  shutdown(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.initialized = false;
    console.log('[TaskScheduler] stopped');
  }
}

export default new CronSchedulerService();
