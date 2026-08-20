import { describe, expect, test } from 'vitest';
import scheduler from '../src/services/account/cronScheduler.service';
import { ScheduleType } from '../src/models/account';

describe('persistent task scheduler', () => {
  test('builds bounded daily, weekly and monthly expressions', () => {
    expect(scheduler.buildCronExpression(ScheduleType.DAILY, { hour: 2, minute: 30 })).toBe('30 2 * * *');
    expect(scheduler.buildCronExpression(ScheduleType.WEEKLY, { dayOfWeek: 1, hour: 3, minute: 5 })).toBe('5 3 * * 1');
    expect(scheduler.buildCronExpression(ScheduleType.MONTHLY, { dayOfMonth: 28, hour: 1, minute: 0 })).toBe('0 1 28 * *');
    expect(scheduler.buildCronExpression(ScheduleType.CRON, { expression: '15 4 * * 2' })).toBe('15 4 * * 2');
    expect(scheduler.buildCronExpression(ScheduleType.MANUAL)).toBeNull();
  });

  test('rejects invalid schedules before persistence', () => {
    expect(() => scheduler.buildCronExpression(ScheduleType.DAILY, { hour: 25 })).toThrow(/调度参数无效/);
    expect(() => scheduler.buildCronExpression(ScheduleType.DAILY, { hour: 1 })).toThrow(/调度参数无效/);
    expect(() => scheduler.buildCronExpression(ScheduleType.WEEKLY, { hour: 1, minute: 0 })).toThrow(/调度参数无效/);
    expect(() => scheduler.buildCronExpression(ScheduleType.CRON, { expression: 'not a cron' })).toThrow(/Cron表达式无效/);
  });
});
