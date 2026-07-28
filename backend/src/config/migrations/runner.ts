import { QueryTypes, Transaction } from 'sequelize';
import sequelize from '../database';
import migrations, { migrationChecksum, type Migration } from './registry';

const LOCK_KEY = 7_301_944_121;

export interface MigrationStatus {
  migrationId: string;
  schemaName: string;
  scope: 'control' | 'tenant';
  applied: boolean;
  checksum: string;
  checksumValid: boolean | null;
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error(`非法 schema: ${value}`);
  return `"${value}"`;
}

async function bootstrap(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      migration_id varchar(120) NOT NULL,
      schema_name varchar(63) NOT NULL,
      checksum varchar(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (migration_id, schema_name)
    )
  `);
}

async function withLock<T>(callback: () => Promise<T>): Promise<T> {
  const manager = (sequelize as any).connectionManager;
  const connection = await manager.getConnection({ type: 'WRITE', useMaster: true });
  const query = (sql: string, values: unknown[]) => new Promise<void>((resolve, reject) => {
    connection.query(sql, values, (error: Error | null) => error ? reject(error) : resolve());
  });
  try {
    // Session-level advisory locks must be acquired and released on the same
    // physical PostgreSQL connection. Using sequelize.query() here could return
    // different pooled connections and strand the lock.
    await query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    // Bootstrap is also kept inside the lock: concurrent CREATE TABLE IF NOT
    // EXISTS calls can still race on PostgreSQL system-catalog constraints.
    await bootstrap();
    return await callback();
  } finally {
    await query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).finally(() => manager.releaseConnection(connection));
  }
}

async function appliedRows(): Promise<Array<{ migration_id: string; schema_name: string; checksum: string }>> {
  await bootstrap();
  return sequelize.query(
    'SELECT migration_id, schema_name, checksum FROM public.schema_migrations ORDER BY applied_at',
    { type: QueryTypes.SELECT },
  ) as Promise<Array<{ migration_id: string; schema_name: string; checksum: string }>>;
}

export async function tenantSchemas(): Promise<string[]> {
  const rows = await sequelize.query<{ schemaName: string }>(
    'SELECT "schemaName" FROM public.tenants ORDER BY "createdAt"',
    { type: QueryTypes.SELECT },
  ).catch(() => []);
  return rows.map((row) => row.schemaName);
}

function targetsFor(migration: Migration, schemas: string[]): string[] {
  return migration.scope === 'control' ? ['public'] : schemas;
}

export async function status(schemas?: string[]): Promise<MigrationStatus[]> {
  const tenantTargets = schemas || await tenantSchemas();
  const rows = await appliedRows();
  const lookup = new Map(rows.map((row) => [`${row.migration_id}:${row.schema_name}`, row]));
  return migrations.flatMap((migration) => targetsFor(migration, tenantTargets).map((schemaName) => {
    const checksum = migrationChecksum(migration);
    const row = lookup.get(`${migration.id}:${schemaName}`);
    return {
      migrationId: migration.id,
      schemaName,
      scope: migration.scope,
      applied: Boolean(row),
      checksum,
      checksumValid: row ? row.checksum === checksum : null,
    };
  }));
}

export async function migrateUp(schemas?: string[]): Promise<void> {
  const tenantTargets = schemas || await tenantSchemas();
  await withLock(async () => {
    const rows = await appliedRows();
    const lookup = new Map(rows.map((row) => [`${row.migration_id}:${row.schema_name}`, row]));
    for (const migration of migrations) {
      for (const schemaName of targetsFor(migration, tenantTargets)) {
        const checksum = migrationChecksum(migration);
        const existing = lookup.get(`${migration.id}:${schemaName}`);
        if (existing) {
          if (existing.checksum !== checksum) throw new Error(`迁移校验和不匹配: ${migration.id}/${schemaName}`);
          continue;
        }
        if (migration.scope === 'tenant') {
          await sequelize.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schemaName)}`);
        }
        await sequelize.transaction({ type: Transaction.TYPES.DEFERRED }, async (transaction) => {
          await migration.up(schemaName, transaction);
          await sequelize.query(
            `INSERT INTO public.schema_migrations (migration_id, schema_name, checksum)
             VALUES (:migrationId, :schemaName, :checksum)`,
            { replacements: { migrationId: migration.id, schemaName, checksum }, transaction },
          );
        });
      }
    }
  });
}

export async function migrateDown(schemaName: string, confirmMigrationId: string): Promise<void> {
  await withLock(async () => {
    const applied = await appliedRows();
    const candidates = migrations.filter((migration) =>
      (migration.scope === 'control' ? schemaName === 'public' : schemaName !== 'public')
      && applied.some((row) => row.migration_id === migration.id && row.schema_name === schemaName));
    const migration = candidates.at(-1);
    if (!migration || migration.id !== confirmMigrationId) {
      throw new Error('仅允许回滚指定 schema 的最后一个迁移，且必须通过 --confirm=<migration_id> 明确确认');
    }
    if (!migration.down) throw new Error(`迁移 ${migration.id} 不支持自动回滚；请先恢复备份`);
    await sequelize.transaction(async (transaction) => {
      await migration.down!(schemaName, transaction);
      await sequelize.query(
        'DELETE FROM public.schema_migrations WHERE migration_id = :migrationId AND schema_name = :schemaName',
        { replacements: { migrationId: migration.id, schemaName }, transaction },
      );
    });
  });
}
