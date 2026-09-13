import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import { buildScheduleConfig } from './TaskForm';

describe('account task schedule payload', () => {
  it('builds all five schedule variants with explicit fields', () => {
    const time = dayjs().hour(9).minute(35);
    expect(buildScheduleConfig('MANUAL', {})).toBeNull();
    expect(buildScheduleConfig('DAILY', { scheduleTime: time })).toEqual({ hour: 9, minute: 35 });
    expect(buildScheduleConfig('WEEKLY', { scheduleTime: time, dayOfWeek: 2 })).toEqual({ hour: 9, minute: 35, dayOfWeek: 2 });
    expect(buildScheduleConfig('MONTHLY', { scheduleTime: time, dayOfMonth: 15 })).toEqual({ hour: 9, minute: 35, dayOfMonth: 15 });
    expect(buildScheduleConfig('CRON', { cronExpression: ' 0 3 * * * ' })).toEqual({ expression: '0 3 * * *' });
  });
});
