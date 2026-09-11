import { afterEach, describe, expect, test, vi } from 'vitest';
import sequelize from '../src/config/database';
import migrations from '../src/config/migrations/registry';

const migration = migrations.find((item) => item.id === '026_tenant_independent_risks')!;

describe('026 independent risk migration', () => {
  afterEach(() => vi.restoreAllMocks());

  test('declares nullable task, origin constraints, indexes and safe repeatable constraint setup', async () => {
    const queries: string[] = [];
    vi.spyOn(sequelize, 'query').mockImplementation(async (sql: any) => {
      queries.push(String(sql));
      if (String(sql).includes('WHERE "creationMode" IS NULL')) return [{ count: 0 }] as any;
      return [] as any;
    });
    await migration.up('tenant_test', {} as any);
    await migration.up('tenant_test', {} as any);
    const sql = queries.join('\n');
    expect(sql).toContain('ALTER COLUMN "taskId" DROP NOT NULL');
    expect(sql).toContain('risk_records_origin_consistency_check');
    expect(sql).toContain('ON DELETE RESTRICT');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS risk_records_creator_fk');
    expect(sql).toContain('risk_records_reviewer_status_idx');
  });

  test('refuses down migration when an independent risk exists', async () => {
    vi.spyOn(sequelize, 'query').mockResolvedValue([{ count: 1 }] as any);
    await expect(migration.down('tenant_test', {} as any)).rejects.toThrow('已存在独立风险');
  });

  test('restores the former task requirement only when no independent risk exists', async () => {
    const queries: string[] = [];
    vi.spyOn(sequelize, 'query').mockImplementation(async (sql: any) => {
      queries.push(String(sql));
      return String(sql).includes('SELECT count(*)') ? [{ count: 0 }] as any : [] as any;
    });
    await migration.down('tenant_test', {} as any);
    expect(queries.join('\n')).toContain('ALTER COLUMN "taskId" SET NOT NULL');
    expect(queries.join('\n')).toContain('ON DELETE CASCADE');
  });
});
