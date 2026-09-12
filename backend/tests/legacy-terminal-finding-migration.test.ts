import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { Sequelize, QueryTypes } from 'sequelize';
import sequelize from '../src/config/database';
import migrations from '../src/config/migrations/registry';

const connection = process.env.LEGACY_FINDING_TEST_DATABASE_URL;
const migration = migrations.find((item) => item.id === '027_tenant_reconcile_legacy_terminal_findings')!;
const schema = 'tenant_027_test';
const actor = '00000000-0000-4000-8000-000000000001';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe.skipIf(!connection)('027 historical terminal finding compensation on isolated PostgreSQL', () => {
  let db: Sequelize;
  let ownsFixtures = false;
  beforeAll(async () => {
    const url = new URL(connection!);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_finding_migration_test')) {
      throw new Error('027 tests require a dedicated local finding migration test database');
    }
    db = new Sequelize(connection!, { logging: false });
    const tables = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`, { type: QueryTypes.SELECT });
    if (tables.length) throw new Error('027 test database must start empty');
    ownsFixtures = true;
    vi.spyOn(sequelize, 'query').mockImplementation(((sql: any, options: any) => db.query(sql, options)) as any);
    await db.query(`CREATE TABLE public.schema_migrations (migration_id text, schema_name text, applied_at timestamptz);
      INSERT INTO public.schema_migrations VALUES ('012_tenant_compliance_assessment_workflow', '${schema}', '2026-01-01');
      CREATE SCHEMA ${schema};
      CREATE TABLE ${schema}.question_items (id uuid PRIMARY KEY, "taskId" uuid, "controlPoint" text, "responsibleDepartmentId" uuid, "assignedTo" uuid);
      CREATE TABLE ${schema}.findings (id uuid PRIMARY KEY, code text, "taskId" uuid, "evaluationId" uuid, title text,
        description text, severity text, status text, disposition text, "ownerDepartmentId" uuid, "ownerUserId" uuid,
        "createdBy" uuid, "dueDate" date, "resolvedAt" timestamptz, "resolvedBy" uuid, "resolutionComment" text,
        "lockVersion" int, "createdAt" timestamptz, "updatedAt" timestamptz);
      CREATE TABLE ${schema}.risk_records (id uuid PRIMARY KEY, status text, "closedAt" timestamptz, "closedBy" uuid, "acceptedAt" timestamptz, "acceptedBy" uuid);
      CREATE TABLE ${schema}.risk_sources ("riskId" uuid, "controlEvaluationId" uuid, "relationType" text, rationale text, "createdBy" uuid);
      CREATE TABLE ${schema}.risk_finding_links ("riskId" uuid, "findingId" uuid, "relationType" text, rationale text);
      CREATE TABLE ${schema}.finding_action_links ("findingId" uuid);`);
    for (let n = 10; n < 20; n++) {
      await db.query(`INSERT INTO ${schema}.question_items VALUES (:id, :actor, 'control', :actor, :actor);
        INSERT INTO ${schema}.findings VALUES (:id, 'FND-' || :id, :actor, :id, 'control', '由历史风险来源迁移生成', 'medium',
          'escalated', 'risk', :actor, :actor, :actor, NULL, NULL, NULL, NULL, 0, '2026-01-01', '2026-01-01');
        INSERT INTO ${schema}.risk_records VALUES (:id, 'closed', '2026-01-02', :actor, NULL, NULL);
        INSERT INTO ${schema}.risk_sources VALUES (:id, :id, 'primary', NULL, :actor);
        INSERT INTO ${schema}.risk_finding_links VALUES (:id, :id, 'primary', NULL)`, { replacements: { id: id(n), actor } });
    }
    await db.query(`UPDATE ${schema}.risk_records SET status='accepted', "acceptedAt"='2026-01-03', "acceptedBy"='${actor}' WHERE id='${id(11)}';
      UPDATE ${schema}.risk_records SET status='open' WHERE id='${id(12)}';
      UPDATE ${schema}.findings SET "lockVersion"=1 WHERE id='${id(13)}';
      UPDATE ${schema}.findings SET "createdAt"='2026-02-01', "updatedAt"='2026-02-01' WHERE id='${id(14)}';
      UPDATE ${schema}.findings SET "resolutionComment"='historical conclusion' WHERE id='${id(15)}';
      UPDATE ${schema}.risk_finding_links SET rationale='different' WHERE "findingId"='${id(16)}';
      UPDATE ${schema}.risk_records SET "closedBy"=NULL WHERE id='${id(17)}';
      INSERT INTO ${schema}.finding_action_links VALUES ('${id(18)}');
      INSERT INTO ${schema}.risk_sources VALUES ('${id(12)}', '${id(19)}', 'supporting', NULL, '${actor}');
      INSERT INTO ${schema}.risk_finding_links VALUES ('${id(12)}', '${id(19)}', 'supporting', NULL);`);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (ownsFixtures) await db.query(`DROP SCHEMA ${schema} CASCADE; DROP TABLE public.schema_migrations`);
    if (db) await db.close();
  });

  test('repairs only untouched 012 rows with all terminal links and restores exact original rows on down', async () => {
    const before = await db.query(`SELECT * FROM ${schema}.findings ORDER BY id`, { type: QueryTypes.SELECT });
    const risksBefore = await db.query(`SELECT * FROM ${schema}.risk_records ORDER BY id`, { type: QueryTypes.SELECT });
    await db.transaction((tx) => migration.up(schema, tx));
    const rows = await db.query<any>(`SELECT * FROM ${schema}.findings ORDER BY id`, { type: QueryTypes.SELECT });
    expect(rows.filter((r) => r.status === 'resolved').map((r) => r.id)).toEqual([id(10), id(11)]);
    expect(rows[0].lockVersion).toBe(1);
    expect(rows[1].resolvedAt.toISOString()).toBe('2026-01-03T00:00:00.000Z');
    expect(rows.slice(2)).toEqual(before.slice(2));
    expect(await db.query(`SELECT * FROM ${schema}.risk_records ORDER BY id`, { type: QueryTypes.SELECT })).toEqual(risksBefore);
    await db.transaction((tx) => migration.down(schema, tx));
    expect(await db.query(`SELECT * FROM ${schema}.findings ORDER BY id`, { type: QueryTypes.SELECT })).toEqual(before);
  });

  test('blocks rollback after business edits and keeps both corrected rows and snapshots', async () => {
    await db.transaction((tx) => migration.up(schema, tx));
    await db.query(`UPDATE ${schema}.findings SET title='new business edit' WHERE id='${id(10)}'`);
    await expect(db.transaction((tx) => migration.down(schema, tx))).rejects.toThrow('后续修改');
    const rows = await db.query<any>(`SELECT * FROM ${schema}.findings WHERE id='${id(10)}'`, { type: QueryTypes.SELECT });
    expect(rows[0].title).toBe('new business edit');
    expect(rows[0].status).toBe('resolved');
    expect(await db.query(`SELECT * FROM ${schema}.legacy_terminal_finding_snapshots`, { type: QueryTypes.SELECT })).toHaveLength(2);
  });
});
