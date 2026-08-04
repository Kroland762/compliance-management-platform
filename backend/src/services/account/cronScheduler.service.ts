import os from 'os';
import cron from 'node-cron';
import { Op, Transaction } from 'sequelize';
import sequelize from '../../config/database';
import TaskSchedule from '../../models/TaskSchedule';
import { ScheduleType } from '../../models/account';
import { getTenantStore, runWithTenantContext } from '../../middlewares/tenant';
import auditTaskService from './auditTask.service';
import { scheduleOperations } from '../metrics.service';
import { config } from '../../config';

type ScheduledTask = ReturnType<typeof cron.schedule>;
const LEASE_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 20 * 1000;

export class CronSchedulerService {
  private jobs = new Map<string, ScheduledTask>();
  private readonly workerId = `${os.hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  private initialized = false;
  private healthy = true;

  constructor(private readonly taskTimeoutMs = config.security.scheduleTaskTimeoutMs) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const schedules = await TaskSchedule.findAll({ where: { enabled: true } });
      schedules.forEach((schedule) => this.startLocalJob(schedule));
      this.healthy = true;
    } catch (error) {
      this.healthy = false;
      throw error;
    }
  }

  status(): { initialized: boolean; healthy: boolean; workerId: string; jobs: number } {
    return { initialized: this.initialized, healthy: this.healthy, workerId: this.workerId, jobs: this.jobs.size };
  }

  async runScheduleNow(scheduleId: string): Promise<void> {
    await this.claimAndExecute(scheduleId);
  }

  async registerJob(taskId: string, scheduleType: ScheduleType, scheduleConfig?: Record<string, any> | null): Promise<void> {
    const context = getTenantStore();
    if (!context?.tenantId || context.schema === 'public') throw new Error('调度注册缺少租户上下文');
    const expression = this.buildCronExpression(scheduleType, scheduleConfig);
    if (!expression || !cron.validate(expression)) {
      await this.unregisterJob(taskId);
      return;
    }
    const [schedule] = await TaskSchedule.upsert({
      tenantId: context.tenantId,
      tenantSchema: context.schema,
      taskId,
      resourceType: 'account_audit',
      resourceId: taskId,
      cronExpression: expression,
      enabled: true,
      consecutiveFailures: 0,
    }, { returning: true });
    this.startLocalJob(schedule);
  }

  async registerResourceJob(
    resourceType: 'assessment_plan' | 'risk_review',
    resourceId: string,
    cronExpression: string,
  ): Promise<void> {
    const context = getTenantStore();
    if (!context?.tenantId || context.schema === 'public') throw new Error('调度注册缺少租户上下文');
    if (!cron.validate(cronExpression)) throw new Error('Cron 表达式无效');
    const [schedule] = await TaskSchedule.upsert({
      tenantId: context.tenantId,
      tenantSchema: context.schema,
      taskId: null,
      resourceType,
      resourceId,
      cronExpression,
      enabled: true,
      consecutiveFailures: 0,
    }, { returning: true });
    this.startLocalJob(schedule);
  }

  async unregisterResourceJob(resourceType: 'assessment_plan' | 'risk_review', resourceId: string): Promise<void> {
    const context = getTenantStore();
    const where: any = { resourceType, resourceId };
    if (context?.tenantId) where.tenantId = context.tenantId;
    const schedules = await TaskSchedule.findAll({ where });
    schedules.forEach((schedule) => {
      this.jobs.get(schedule.id)?.stop();
      this.jobs.delete(schedule.id);
    });
    await TaskSchedule.update({ enabled: false }, { where });
  }

  async unregisterJob(taskId: string): Promise<void> {
    const context = getTenantStore();
    const where: any = { resourceType: 'account_audit', resourceId: taskId };
    if (context?.tenantId) where.tenantId = context.tenantId;
    const schedules = await TaskSchedule.findAll({ where });
    schedules.forEach((schedule) => {
      this.jobs.get(schedule.id)?.stop();
      this.jobs.delete(schedule.id);
    });
    await TaskSchedule.update({ enabled: false }, { where });
  }

  private startLocalJob(schedule: TaskSchedule): void {
    this.jobs.get(schedule.id)?.stop();
    const job = cron.schedule(schedule.cronExpression, () => {
      void this.claimAndExecute(schedule.id);
    }, { timezone: config.businessTimeZone });
    this.jobs.set(schedule.id, job);
  }

  private async claimAndExecute(scheduleId: string): Promise<void> {
    const currentSlot = new Date();
    currentSlot.setSeconds(0, 0);
    const schedule = await sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, async (transaction) => {
      const row = await TaskSchedule.findOne({
        where: {
          id: scheduleId,
          enabled: true,
          [Op.and]: [
            { [Op.or]: [{ leasedUntil: null }, { leasedUntil: { [Op.lt]: new Date() } }] },
            { [Op.or]: [{ lastRunAt: null }, { lastRunAt: { [Op.lt]: currentSlot } }] },
          ],
        },
        lock: Transaction.LOCK.UPDATE,
        skipLocked: true,
        transaction,
      });
      if (!row) return null;
      await row.update({
        workerId: this.workerId,
        heartbeatAt: new Date(),
        leasedUntil: new Date(Date.now() + LEASE_MS),
      }, { transaction });
      return row;
    });
    if (!schedule) return;

    const heartbeat = setInterval(() => {
      void TaskSchedule.update({
        heartbeatAt: new Date(),
        leasedUntil: new Date(Date.now() + LEASE_MS),
      }, { where: { id: schedule.id, workerId: this.workerId } });
    }, HEARTBEAT_MS);
    heartbeat.unref();

    const idempotencyKey = `${schedule.id}:${currentSlot.toISOString()}`;
    try {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const execution = runWithTenantContext(
        { schema: schedule.tenantSchema, tenantId: schedule.tenantId },
        async () => {
          if (schedule.resourceType === 'assessment_plan') {
            const assessmentPlanService = (await import('../assessment-plan.service')).default;
            return assessmentPlanService.executeScheduled(schedule.resourceId, idempotencyKey, this.workerId);
          }
          if (schedule.resourceType === 'risk_review') {
            const riskDomainService = (await import('../risk-domain.service')).default;
            return riskDomainService.sendAcceptedRiskReviewReminder(schedule.resourceId);
          }
          return auditTaskService.executeTaskScheduled(schedule.resourceId, idempotencyKey, this.workerId);
        },
      );
      const timeoutFailure = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`计划任务执行超过 ${this.taskTimeoutMs}ms`)),
          this.taskTimeoutMs,
        );
        timeout.unref();
      });
      try {
        const outcome: any = await Promise.race([execution, timeoutFailure]);
        if (outcome?.disableSchedule) {
          schedule.enabled = false;
          this.jobs.get(schedule.id)?.stop();
          this.jobs.delete(schedule.id);
        }
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      await schedule.update({
        enabled: schedule.enabled,
        lastRunAt: new Date(),
        lastOutcome: 'success',
        consecutiveFailures: 0,
        workerId: null,
        leasedUntil: null,
        heartbeatAt: null,
      });
      scheduleOperations.inc({ outcome: 'success' });
    } catch (error) {
      const failures = schedule.consecutiveFailures + 1;
      await schedule.update({
        lastRunAt: new Date(),
        lastOutcome: 'failed',
        consecutiveFailures: failures,
        workerId: null,
        leasedUntil: new Date(Date.now() + Math.min(60 * 60 * 1000, 2 ** failures * 30_000)),
        heartbeatAt: null,
      });
      scheduleOperations.inc({ outcome: 'failure' });
    } finally {
      clearInterval(heartbeat);
    }
  }

  buildCronExpression(type: ScheduleType, scheduleConfig?: Record<string, any> | null): string | null {
    const numberInRange = (value: unknown, fallback: number, min: number, max: number): number => {
      const number = value === undefined ? fallback : Number(value);
      if (!Number.isInteger(number) || number < min || number > max) {
        throw new Error('任务调度参数无效');
      }
      return number;
    };
    const hour = numberInRange(scheduleConfig?.hour, 0, 0, 23);
    const minute = numberInRange(scheduleConfig?.minute, 0, 0, 59);
    let expression: string | null = null;
    if (type === ScheduleType.MANUAL) return null;
    if (type === ScheduleType.DAILY) expression = `${minute} ${hour} * * *`;
    if (type === ScheduleType.WEEKLY) {
      expression = `${minute} ${hour} * * ${numberInRange(scheduleConfig?.dayOfWeek, 1, 0, 6)}`;
    }
    if (type === ScheduleType.MONTHLY) {
      expression = `${minute} ${hour} ${numberInRange(scheduleConfig?.dayOfMonth, 1, 1, 28)} * *`;
    }
    if (type === ScheduleType.CRON) {
      expression = typeof scheduleConfig?.expression === 'string' ? scheduleConfig.expression.trim() : null;
    }
    if (!expression) return null;
    if (!cron.validate(expression)) throw new Error('Cron表达式无效');
    return expression;
  }

  shutdown(): void {
    this.jobs.forEach((job) => job.stop());
    this.jobs.clear();
    this.initialized = false;
  }
}

export default new CronSchedulerService();
