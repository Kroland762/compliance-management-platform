import { afterEach, describe, expect, test, vi } from 'vitest';

type FakeMigration = {
  id: string;
  scope: 'control' | 'tenant';
  description: string;
  checksumSource: string;
  transactional: false;
  up: ReturnType<typeof vi.fn>;
  down: ReturnType<typeof vi.fn>;
};

async function runnerFor(migration: FakeMigration, applied = false) {
  const physicalQuery = vi.fn((_sql: string, _values: unknown[], callback: (error: Error | null) => void) => callback(null));
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT migration_id')) return applied
      ? [{ migration_id: migration.id, schema_name: 'tenant_test', checksum: `sum:${migration.id}` }]
      : [];
    return [];
  });
  const sequelize = {
    query,
    transaction: vi.fn(),
    connectionManager: {
      getConnection: vi.fn(async () => ({ query: physicalQuery })),
      releaseConnection: vi.fn(),
    },
  };
  vi.resetModules();
  vi.doMock('../src/config/database', () => ({ default: sequelize }));
  vi.doMock('../src/config/migrations/registry', () => ({
    default: [migration],
    migrationChecksum: (item: FakeMigration) => `sum:${item.id}`,
  }));
  return { runner: await import('../src/config/migrations/runner'), sequelize, query };
}

describe('non-transactional migration runner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/config/database');
    vi.doUnmock('../src/config/migrations/registry');
  });

  test('runs concurrent-index migrations outside a transaction and records success afterwards', async () => {
    const migration: FakeMigration = {
      id: '999_tenant_concurrent', scope: 'tenant', description: 'test', checksumSource: 'test', transactional: false,
      up: vi.fn().mockResolvedValue(undefined), down: vi.fn().mockResolvedValue(undefined),
    };
    const { runner, sequelize, query } = await runnerFor(migration);

    await runner.migrateUp(['tenant_test']);

    expect(migration.up).toHaveBeenCalledWith('tenant_test');
    expect(sequelize.transaction).not.toHaveBeenCalled();
    const upOrder = migration.up.mock.invocationCallOrder[0];
    const insertCall = query.mock.calls.findIndex(([sql]) => String(sql).includes('INSERT INTO public.schema_migrations'));
    expect(insertCall).toBeGreaterThan(-1);
    expect(upOrder).toBeLessThan(query.mock.invocationCallOrder[insertCall]);
  });

  test('does not register a partially failed non-transactional migration', async () => {
    const migration: FakeMigration = {
      id: '999_tenant_failed', scope: 'tenant', description: 'test', checksumSource: 'test', transactional: false,
      up: vi.fn().mockRejectedValue(new Error('index build failed')), down: vi.fn(),
    };
    const { runner, query } = await runnerFor(migration);

    await expect(runner.migrateUp(['tenant_test'])).rejects.toThrow('index build failed');
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO public.schema_migrations'))).toBe(false);
  });

  test('drops a concurrent index before deleting the migration record', async () => {
    const migration: FakeMigration = {
      id: '999_tenant_down', scope: 'tenant', description: 'test', checksumSource: 'test', transactional: false,
      up: vi.fn(), down: vi.fn().mockResolvedValue(undefined),
    };
    const { runner, sequelize, query } = await runnerFor(migration, true);

    await runner.migrateDown('tenant_test', migration.id);

    expect(migration.down).toHaveBeenCalledWith('tenant_test');
    expect(sequelize.transaction).not.toHaveBeenCalled();
    const deleteCall = query.mock.calls.findIndex(([sql]) => String(sql).includes('DELETE FROM public.schema_migrations'));
    expect(deleteCall).toBeGreaterThan(-1);
    expect(migration.down.mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[deleteCall]);
  });
});
