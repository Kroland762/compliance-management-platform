import { afterEach, describe, expect, test, vi } from 'vitest';
import sequelize from '../src/config/database';
import {
  ProblemAccount,
  ProblemStatus,
  ProblemStatusChangeSource,
  ProblemStatusHistory,
} from '../src/models/account';
import problemService from '../src/services/account/problem.service';
import auditLogService from '../src/services/audit-log.service';

const problem = (id: string, status: ProblemStatus) => {
  const value: any = {
    id,
    status,
    update: vi.fn(async (updates: Record<string, unknown>) => Object.assign(value, updates)),
    toJSON: vi.fn(() => ({ ...value })),
  };
  return value;
};

afterEach(() => vi.restoreAllMocks());

describe('account problem status transitions', () => {
  test.each([
    [ProblemStatus.PENDING, ProblemStatus.PROCESSING],
    [ProblemStatus.PENDING, ProblemStatus.RESOLVED],
    [ProblemStatus.PENDING, ProblemStatus.FALSE_POSITIVE],
    [ProblemStatus.PENDING, ProblemStatus.IGNORED],
    [ProblemStatus.PROCESSING, ProblemStatus.RESOLVED],
    [ProblemStatus.PROCESSING, ProblemStatus.PENDING],
    [ProblemStatus.RESOLVED, ProblemStatus.PENDING],
    [ProblemStatus.AUTO_RESOLVED, ProblemStatus.PROCESSING],
    [ProblemStatus.FALSE_POSITIVE, ProblemStatus.PENDING],
    [ProblemStatus.IGNORED, ProblemStatus.PENDING],
  ])('allows %s -> %s', (from, to) => {
    expect(() => (problemService as any).validateStatusTransition(from, to)).not.toThrow();
  });

  test.each([
    [ProblemStatus.PENDING, ProblemStatus.PENDING],
    [ProblemStatus.RESOLVED, ProblemStatus.PROCESSING],
    [ProblemStatus.FALSE_POSITIVE, ProblemStatus.RESOLVED],
    [ProblemStatus.IGNORED, ProblemStatus.AUTO_RESOLVED],
  ])('rejects %s -> %s', (from, to) => {
    expect(() => (problemService as any).validateStatusTransition(from, to)).toThrow(/不允许/);
  });

  test('deduplicates IDs, writes atomic history and reports the real update count', async () => {
    const first = problem('00000000-0000-4000-8000-000000000001', ProblemStatus.PENDING);
    const second = problem('00000000-0000-4000-8000-000000000002', ProblemStatus.PROCESSING);
    vi.spyOn(sequelize, 'transaction').mockImplementation(async (callback: any) => callback({ LOCK: { UPDATE: 'UPDATE' } }));
    vi.spyOn(ProblemAccount, 'findAll').mockResolvedValue([first, second] as any);
    const history = vi.spyOn(ProblemStatusHistory, 'create').mockResolvedValue({} as any);
    vi.spyOn(auditLogService, 'log').mockResolvedValue(undefined);

    const result = await problemService.bulkUpdateStatus({
      ids: [first.id, first.id, second.id],
      status: ProblemStatus.RESOLVED,
      notes: 'confirmed',
    }, '00000000-0000-4000-8000-000000000099');

    expect(result).toEqual({ updatedCount: 2 });
    expect(first.update).toHaveBeenCalledWith(expect.objectContaining({
      status: ProblemStatus.RESOLVED,
      resolvedBy: '00000000-0000-4000-8000-000000000099',
      resolvedAt: expect.any(Date),
    }), expect.anything());
    expect(history).toHaveBeenCalledTimes(2);
    expect(history).toHaveBeenCalledWith(expect.objectContaining({
      fromStatus: ProblemStatus.PENDING,
      toStatus: ProblemStatus.RESOLVED,
      source: ProblemStatusChangeSource.BULK,
    }), expect.anything());
  });

  test('does not mutate any row when a mixed batch has an illegal transition', async () => {
    const valid = problem('00000000-0000-4000-8000-000000000001', ProblemStatus.PENDING);
    const invalid = problem('00000000-0000-4000-8000-000000000002', ProblemStatus.RESOLVED);
    vi.spyOn(sequelize, 'transaction').mockImplementation(async (callback: any) => callback({ LOCK: { UPDATE: 'UPDATE' } }));
    vi.spyOn(ProblemAccount, 'findAll').mockResolvedValue([valid, invalid] as any);

    await expect(problemService.bulkUpdateStatus({
      ids: [valid.id, invalid.id],
      status: ProblemStatus.PROCESSING,
    }, '00000000-0000-4000-8000-000000000099')).rejects.toThrow(/不允许/);
    expect(valid.update).not.toHaveBeenCalled();
    expect(invalid.update).not.toHaveBeenCalled();
  });

  test('rejects a missing ID before updating any row', async () => {
    const existing = problem('00000000-0000-4000-8000-000000000001', ProblemStatus.PENDING);
    vi.spyOn(sequelize, 'transaction').mockImplementation(async (callback: any) => callback({ LOCK: { UPDATE: 'UPDATE' } }));
    vi.spyOn(ProblemAccount, 'findAll').mockResolvedValue([existing] as any);

    await expect(problemService.bulkUpdateStatus({
      ids: [existing.id, '00000000-0000-4000-8000-000000000002'],
      status: ProblemStatus.RESOLVED,
    }, '00000000-0000-4000-8000-000000000099')).rejects.toThrow(/不存在/);
    expect(existing.update).not.toHaveBeenCalled();
  });
});
