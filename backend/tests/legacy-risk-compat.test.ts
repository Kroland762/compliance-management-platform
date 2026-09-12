import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { QueryTypes, Sequelize } from 'sequelize';
import { importLegacyTables, risksWithoutTask } from '../src/config/migrations/legacy-risk-compat';

const connection = process.env.MIGRATION_COMPAT_TEST_DATABASE_URL;
const schema = 'migration_risk_compat';
const owner = '11111111-1111-4111-8111-111111111111';
const sourceActor = '22222222-2222-4222-8222-222222222222';
const findingActor = '33333333-3333-4333-8333-333333333333';
const risk = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const risk2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// This suite owns a dedicated empty PostgreSQL database, never the configured application DB.
describe.skipIf(!connection)('legacy risk compatibility on isolated PostgreSQL', () => {
  let db: Sequelize;
  let ownsFixtures = false;
  beforeAll(async () => {
    const url = new URL(connection!);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || !/^\/(compliance_fix_compat|[a-z0-9_]+_migration_compat_test)$/.test(url.pathname)) {
      throw new Error('Compatibility tests require a dedicated local migration compatibility test database');
    }
    db = new Sequelize(connection!, { logging: false });
    const existing = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`, { type: QueryTypes.SELECT });
    if (existing.length) throw new Error('Compatibility test database must start empty');
    ownsFixtures = true;
  });
  beforeEach(async () => {
    if (!ownsFixtures) return;
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query('CREATE TABLE public.users (id uuid PRIMARY KEY)');
    await db.query(`INSERT INTO public.users VALUES ('${owner}'), ('${sourceActor}'), ('${findingActor}')`);
    await db.query(`CREATE TABLE public.risk_records (
      id uuid PRIMARY KEY, "taskId" uuid, title text, "ownerUserId" uuid)`);
    await db.query(`CREATE TABLE ${schema}.risk_records (
      id uuid PRIMARY KEY, "taskId" uuid, title text, "ownerUserId" uuid,
      "creationMode" varchar(24) NOT NULL CHECK ("creationMode" IN ('manual','evaluation','finding_escalation','import')),
      "discoverySource" varchar(32) NOT NULL,
      "createdBy" uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT)`);
  });
  afterEach(async () => {
    if (!ownsFixtures) return;
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.query('DROP TABLE IF EXISTS public.risk_finding_links, public.risk_sources, public.risk_records, public.audit_tasks, public.users CASCADE');
  });
  afterAll(async () => { if (db) await db.close(); });

  const insertRisk = async (actor: string | null = owner) => db.query(
    'INSERT INTO public.risk_records VALUES (:id, NULL, :title, :actor)',
    { replacements: { id: risk, title: '原始风险', actor } },
  );
  const importRisks = () => importLegacyTables(db, schema, owner, [{ table: 'risk_records', rows: 1 }]);

  test('004-stage membership plan reads historical labels without title or creationMode', async () => {
    await db.query(`ALTER TABLE public.risk_records RENAME COLUMN title TO "riskIdentification"`);
    await db.query(`INSERT INTO public.risk_records VALUES ('${risk}', NULL, '旧风险描述', '${owner}')`);
    expect(await risksWithoutTask(db, 'public')).toEqual([{ id: risk, taskId: null, title: '旧风险描述' }]);
  });

  test('pre-026 membership plan does not reference unavailable creationMode', async () => {
    await insertRisk();
    expect(await risksWithoutTask(db, 'public')).toEqual([{ id: risk, taskId: null, title: '原始风险' }]);
  });

  test('post-026 membership plan excludes manual rows while retaining unmapped and imported risks', async () => {
    await insertRisk();
    await db.query('ALTER TABLE public.risk_records ADD COLUMN "creationMode" varchar(24)');
    await db.query(`INSERT INTO public.risk_records VALUES ('${risk2}', NULL, '人工风险', '${owner}', 'manual')`);
    expect(await risksWithoutTask(db, 'public')).toEqual([{ id: risk, taskId: null, title: '原始风险', creationMode: null }]);
    await db.query(`UPDATE public.risk_records SET "creationMode" = 'import' WHERE id = '${risk}'`);
    expect(await risksWithoutTask(db, 'public')).toEqual([{ id: risk, taskId: null, title: '原始风险', creationMode: 'import' }]);
  });

  test('imports missing origin fields using owner and verifies duplicate imports without changing public rows', async () => {
    await insertRisk();
    const before = await db.query('SELECT * FROM public.risk_records', { type: QueryTypes.SELECT });
    const first = await importRisks();
    expect(await importRisks()).toEqual(first);
    expect(await db.query(`SELECT * FROM ${schema}.risk_records`, { type: QueryTypes.SELECT })).toEqual([
      { ...(before[0] as object), creationMode: 'import', discoverySource: 'compliance_assessment', createdBy: owner },
    ]);
    expect(await db.query('SELECT * FROM public.risk_records', { type: QueryTypes.SELECT })).toEqual(before);
  });

  test('uses the earliest finding author ahead of source and owner, then source when finding table is absent', async () => {
    await insertRisk();
    for (const table of ['risk_finding_links', 'risk_sources']) {
      await db.query(`CREATE TABLE public.${table} ("riskId" uuid, "createdBy" uuid, "createdAt" timestamptz)`);
    }
    await db.query(`INSERT INTO public.risk_finding_links VALUES ('${risk}', '${owner}', '2026-02-01'), ('${risk}', '${findingActor}', '2026-01-01')`);
    await db.query(`INSERT INTO public.risk_sources VALUES ('${risk}', '${sourceActor}', '2025-01-01')`);
    await importRisks();
    expect(await db.query(`SELECT "createdBy" FROM ${schema}.risk_records`, { type: QueryTypes.SELECT })).toEqual([{ createdBy: findingActor }]);
    await db.query(`DELETE FROM ${schema}.risk_records`);
    await db.query('DROP TABLE public.risk_finding_links');
    await importRisks();
    expect(await db.query(`SELECT "createdBy" FROM ${schema}.risk_records`, { type: QueryTypes.SELECT })).toEqual([{ createdBy: sourceActor }]);
  });

  test('rejects missing authors with a risk ID and rolls back earlier table copies', async () => {
    await insertRisk(null);
    await db.query('CREATE TABLE public.audit_tasks (id uuid PRIMARY KEY)');
    await db.query(`CREATE TABLE ${schema}.audit_tasks (id uuid PRIMARY KEY)`);
    await db.query(`INSERT INTO public.audit_tasks VALUES ('${risk2}')`);
    await expect(importLegacyTables(db, schema, owner, [
      { table: 'audit_tasks', rows: 1 }, { table: 'risk_records', rows: 1 },
    ])).rejects.toThrow(`风险创建人缺失或不存在于 public.users: ${risk}`);
    expect(await db.query(`SELECT * FROM ${schema}.audit_tasks`, { type: QueryTypes.SELECT })).toEqual([]);
    expect(await db.query(`SELECT * FROM ${schema}.risk_records`, { type: QueryTypes.SELECT })).toEqual([]);
    expect(await db.query('SELECT id FROM public.risk_records', { type: QueryTypes.SELECT })).toEqual([{ id: risk }]);
  });

  test('rejects an invalid historical author even when the owner exists', async () => {
    await insertRisk();
    await db.query('CREATE TABLE public.risk_sources ("riskId" uuid, "createdBy" uuid, "createdAt" timestamptz)');
    await db.query(`INSERT INTO public.risk_sources VALUES ('${risk}', '${risk2}', now())`);
    await expect(importRisks()).rejects.toThrow(`风险创建人缺失或不存在于 public.users: ${risk}`);
  });

  test('reports a missing author when the legacy table has no owner field', async () => {
    await insertRisk();
    await db.query('ALTER TABLE public.risk_records DROP COLUMN "ownerUserId"');
    await expect(importRisks()).rejects.toThrow(`风险创建人缺失或不存在于 public.users: ${risk}`);
  });

  test('keeps supplied origin fields and validates their author', async () => {
    await insertRisk();
    await db.query(`ALTER TABLE public.risk_records ADD COLUMN "creationMode" varchar(24), ADD COLUMN "discoverySource" varchar(32), ADD COLUMN "createdBy" uuid`);
    await db.query(`UPDATE public.risk_records SET "creationMode" = 'manual', "discoverySource" = 'daily_operations', "createdBy" = '${findingActor}'`);
    await importRisks();
    expect(await db.query(`SELECT "creationMode", "discoverySource", "createdBy" FROM ${schema}.risk_records`, { type: QueryTypes.SELECT })).toEqual([
      { creationMode: 'manual', discoverySource: 'daily_operations', createdBy: findingActor },
    ]);
    await db.query(`UPDATE public.risk_records SET "createdBy" = '${risk2}'`);
    await expect(importRisks()).rejects.toThrow(`风险创建人缺失或不存在于 public.users: ${risk}`);
  });

  test('duplicate imports still reject mismatched shared fields', async () => {
    await insertRisk();
    await importRisks();
    await db.query(`UPDATE ${schema}.risk_records SET title = '已被修改'`);
    await expect(importRisks()).rejects.toThrow('risk_records 哈希核对失败');
  });
});
