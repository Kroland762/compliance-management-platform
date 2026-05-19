import cron from 'node-cron';
import { AccountAuditTask, ScheduleType, TaskStatus } from '../../models/account';
import auditTaskService from './auditTask.service';
import { v4 as uuidv4 } from 'uuid';

type ScheduledTask = ReturnType<typeof cron.schedule>;

/**
 * Cron-based task scheduler for account audit tasks.
 *
 * On startup, loads all ACTIVE tasks with scheduleType != MANUAL and registers cron jobs.
 * Provides methods to register/unregister jobs when tasks are created/updated/deleted.
 * When a scheduled task fires, it creates an execution record with triggerType=SCHEDULED.
 */
class CronSchedulerService {
  private jobs: Map<string, ScheduledTask> = new Map();
  private initialized = false;

  /**
   * Initialize scheduler: load all active scheduled tasks from DB and register cron jobs.
   * Call once on app startup.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const tasks = await AccountAuditTask.findAll({
        where: {
          status: TaskStatus.ACTIVE,
          scheduleType: {
            [require('sequelize').Op.not]: ScheduleType.MANUAL,
          },
        },
      });

      console.log(`[CronScheduler] Loading ${tasks.length} active scheduled task(s)...`);

      for (const task of tasks) {
        this.registerJob(task.id, task.scheduleType, task.scheduleConfig as any);
      }

      console.log(`[CronScheduler] Initialization complete. ${this.jobs.size} cron job(s) registered.`);
    } catch (error: any) {
      console.error(`[CronScheduler] Initialization failed: ${error.message}`);
    }
  }

  /**
   * Register (or re-register) a cron job for a given task.
   * Unregisters any existing job for this taskId first.
   */
  registerJob(taskId: string, scheduleType: ScheduleType, scheduleConfig?: Record<string, any> | null): void {
    const expr = this.buildCronExpression(scheduleType, scheduleConfig);
    if (!expr) {
      console.log(`[CronScheduler] Task ${taskId} has scheduleType ${scheduleType} but no valid config — skipping.`);
      return;
    }

    // Unregister any existing job for this taskId
    this.unregisterJob(taskId);

    try {
      const job = cron.schedule(expr, async () => {
        await this.executeScheduledTask(taskId);
      }, {
        timezone: 'Asia/Shanghai',
      });

      this.jobs.set(taskId, job);
      console.log(`[CronScheduler] Registered cron job for task ${taskId}: "${expr}"`);
    } catch (error: any) {
      console.error(`[CronScheduler] Failed to register cron job for task ${taskId}: ${error.message}`);
    }
  }

  /**
   * Unregister the cron job for a given taskId.
   */
  unregisterJob(taskId: string): void {
    const existing = this.jobs.get(taskId);
    if (existing) {
      existing.stop();
      this.jobs.delete(taskId);
      console.log(`[CronScheduler] Unregistered cron job for task ${taskId}`);
    }
  }

  /**
   * Build a cron expression from scheduleType and scheduleConfig.
   */
  private buildCronExpression(scheduleType: ScheduleType, config?: Record<string, any> | null): string | null {
    switch (scheduleType) {
      case ScheduleType.MANUAL:
        return null;

      case ScheduleType.DAILY: {
        const hour = config?.hour ?? 0;
        const minute = config?.minute ?? 0;
        return `${minute} ${hour} * * *`;
      }

      case ScheduleType.WEEKLY: {
        const dayOfWeek = config?.dayOfWeek ?? 1; // 0=Sun, 1=Mon, ...
        const hour = config?.hour ?? 0;
        const minute = config?.minute ?? 0;
        return `${minute} ${hour} * * ${dayOfWeek}`;
      }

      case ScheduleType.MONTHLY: {
        const dayOfMonth = config?.dayOfMonth ?? 1;
        const hour = config?.hour ?? 0;
        const minute = config?.minute ?? 0;
        return `${minute} ${hour} ${dayOfMonth} * *`;
      }

      case ScheduleType.CRON: {
        const expression = config?.expression;
        if (!expression || typeof expression !== 'string') {
          console.warn(`[CronScheduler] CRON scheduleType but no expression in config.`);
          return null;
        }
        return expression;
      }

      default:
        return null;
    }
  }

  /**
   * Execute a task triggered by cron. Sets triggerType=SCHEDULED.
   */
  private async executeScheduledTask(taskId: string): Promise<void> {
    console.log(`[CronScheduler] Scheduled execution triggered for task ${taskId}`);

    try {
      // Re-fetch the task to ensure it's still ACTIVE
      const task = await AccountAuditTask.findByPk(taskId);
      if (!task || task.status !== TaskStatus.ACTIVE) {
        console.log(`[CronScheduler] Task ${taskId} is no longer active — skipping.`);
        this.unregisterJob(taskId);
        return;
      }

      // Execute with a system user as the triggeredBy
      const result = await auditTaskService.executeTaskScheduled(taskId);

      console.log(
        `[CronScheduler] Task ${taskId} executed: ` +
        `${result.accountsProcessed} accounts, ${result.problemsFound} problems found.`
      );
    } catch (error: any) {
      console.error(`[CronScheduler] Scheduled task ${taskId} failed: ${error.message}`);
    }
  }

  /**
   * Stop all cron jobs. Useful for graceful shutdown.
   */
  shutdown(): void {
    console.log(`[CronScheduler] Shutting down ${this.jobs.size} cron job(s)...`);
    for (const [taskId, job] of this.jobs) {
      job.stop();
    }
    this.jobs.clear();
    console.log('[CronScheduler] All cron jobs stopped.');
  }
}

export default new CronSchedulerService();
