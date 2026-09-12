import { describe, expect, test } from 'vitest';
import {
  dataSourceListQuery,
  problemListQuery,
  ruleListQuery,
  taskListQuery,
} from '../src/routes/account/validation';

const validates = (schema: any, value: unknown) => !schema.validate(value, {
  allowUnknown: false,
  stripUnknown: false,
}).error;

describe('account audit query contract', () => {
  test('accepts only the canonical data-source parameters and uppercase enums', () => {
    expect(validates(dataSourceListQuery, { search: 'pg', sourceType: 'DATABASE', status: 'ACTIVE' })).toBe(true);
    expect(validates(dataSourceListQuery, { search: 'hr', sourceType: 'CSV', status: 'ACTIVE' })).toBe(true);
    expect(validates(dataSourceListQuery, { keyword: 'legacy' })).toBe(false);
    expect(validates(dataSourceListQuery, { status: 'active' })).toBe(false);
  });

  test('accepts only the canonical rule parameters', () => {
    expect(validates(ruleListQuery, { search: 'inactive', ruleType: 'BUILTIN', severity: 'HIGH', isActive: true })).toBe(true);
    expect(validates(ruleListQuery, { type: 'BUILTIN' })).toBe(false);
    expect(validates(ruleListQuery, { severity: 'high' })).toBe(false);
  });

  test('accepts only the canonical task parameters', () => {
    expect(validates(taskListQuery, { search: 'daily', status: 'ACTIVE', scheduleType: 'CRON' })).toBe(true);
    expect(validates(taskListQuery, { keyword: 'legacy' })).toBe(false);
    expect(validates(taskListQuery, { status: 'active' })).toBe(false);
  });

  test('validates problem filters, enums and ISO date ranges', () => {
    expect(validates(problemListQuery, {
      search: 'alice',
      taskId: '0fd07e13-e59e-4a39-aa7a-8f3fb3c382de',
      ruleId: 'c9c76dd7-4f9e-4478-afca-9459bd90e2bc',
      status: 'PENDING',
      severity: 'MEDIUM',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-13',
    })).toBe(true);
    expect(validates(problemListQuery, { keyword: 'legacy' })).toBe(false);
    expect(validates(problemListQuery, { status: 'pending' })).toBe(false);
    expect(validates(problemListQuery, { dateFrom: '2026-08-13', dateTo: '2026-08-01' })).toBe(false);
    expect(validates(problemListQuery, { dateFrom: 'not-a-date' })).toBe(false);
  });
});
