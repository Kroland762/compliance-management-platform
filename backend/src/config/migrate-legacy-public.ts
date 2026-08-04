#!/usr/bin/env node
import { QueryTypes, Transaction } from 'sequelize';
import sequelize from './database';
import Tenant from '../models/Tenant';
import { migrateUp } from './migrations/runner';

const BUSINESS_TABLES = [
  'roles',
  'departments',
  'department_members',
  'questionnaire_templates',
  'question_templates',
  'audit_tasks',
  'question_items',
  'evidence_files',
  'risk_records',
  'notifications',
  'audit_logs',
  'qualifications',
  'account_data_sources',
  'account_data',
  'account_audit_rules',
  'account_audit_tasks',
  'account_problems',
  'account_task_executions',
  'system_settings',
];

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
}

function quote(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) throw new Error(`非法标识符: ${value}`);
  return `"${value}"`;
}

async function tableExists(schema: string, table: string): Promise<boolean> {
  const rows = await sequelize.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = :schema AND table_name = :table`,
    { replacements: { schema, table }, type: QueryTypes.SELECT },
  );
  return rows.length > 0;
}

async function count(schema: string, table: string): Promise<number> {
  const [row] = await sequelize.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${quote(schema)}.${quote(table)}`,
    { type: QueryTypes.SELECT },
  );
  return Number(row?.count || 0);
}

async function columns(schema: string, table: string): Promise<string[]> {
  const rows = await sequelize.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = :schema AND table_name = :table ORDER BY ordinal_position`,
    { replacements: { schema, table }, type: QueryTypes.SELECT },
  );
  return rows.map((row) => row.column_name);
}

async function rowHash(
  schema: string,
  table: string,
  selectedColumns: string[],
  transaction: Transaction,
  restrictToPublicIds = false,
): Promise<string> {
  const projected = selectedColumns.map(quote).join(', ');
  const restriction = restrictToPublicIds
    ? `WHERE id IN (SELECT id FROM public.${quote(table)})`
    : '';
  const [row] = await sequelize.query<{ hash: string }>(
    `SELECT md5(COALESCE(
       string_agg(md5(to_jsonb(row_data)::text), '' ORDER BY row_data.id::text),
       ''
     )) AS hash
     FROM (
       SELECT ${projected}
       FROM ${quote(schema)}.${quote(table)}
       ${restriction}
     ) row_data`,
    { type: QueryTypes.SELECT, transaction },
  );
  return row.hash;
}

async function main(): Promise<void> {
  await sequelize.authenticate();
  const report: Array<{ table: string; rows: number }> = [];
  for (const table of BUSINESS_TABLES) {
    if (await tableExists('public', table)) {
      report.push({ table, rows: await count('public', table) });
    }
  }
  console.table(report);

  const apply = process.argv.includes('--apply');
  if (!apply) {
    console.log('ℹ️ 仅生成清单；应用迁移必须显式提供 --apply --tenant=<tenant_id>');
    return;
  }
  const tenantId = option('tenant');
  if (!tenantId) throw new Error('缺少目标租户映射：--tenant=<tenant_id>');
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new Error('目标租户不存在');
  await migrateUp([tenant.schemaName]);

  await sequelize.transaction({ type: Transaction.TYPES.DEFERRED }, async (transaction) => {
    await sequelize.query('SET CONSTRAINTS ALL DEFERRED', { transaction }).catch(() => undefined);
    for (const { table, rows } of report) {
      if (rows === 0 || !await tableExists(tenant.schemaName, table)) continue;
      const sourceColumns = await columns('public', table);
      const targetColumns = await columns(tenant.schemaName, table);
      const shared = targetColumns.filter((column) => sourceColumns.includes(column));
      if (!shared.includes('id')) throw new Error(`${table} 缺少可核对的 id 字段`);
      const insertColumns = [...shared];
      const selectColumns = shared.map((column) => `p.${quote(column)}`);
      if (table === 'roles' && targetColumns.includes('tenantId') && !sourceColumns.includes('tenantId')) {
        insertColumns.push('tenantId');
        selectColumns.push(':tenantId');
      }
      await sequelize.query(
        `INSERT INTO ${quote(tenant.schemaName)}.${quote(table)} (${insertColumns.map(quote).join(', ')})
         SELECT ${selectColumns.join(', ')} FROM public.${quote(table)} p
         ON CONFLICT (id) DO NOTHING`,
        { replacements: { tenantId: tenant.id }, transaction },
      );
      const [verified] = await sequelize.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM ${quote(tenant.schemaName)}.${quote(table)} t
         JOIN public.${quote(table)} p ON p.id = t.id`,
        { type: QueryTypes.SELECT, transaction },
      );
      if (Number(verified.count) !== rows) {
        throw new Error(`${table} 数量核对失败: source=${rows}, target=${verified.count}`);
      }
      const sourceHash = await rowHash('public', table, shared, transaction);
      const targetHash = await rowHash(tenant.schemaName, table, shared, transaction, true);
      if (sourceHash !== targetHash) {
        throw new Error(`${table} 哈希核对失败: source=${sourceHash}, target=${targetHash}`);
      }
      console.log(`✓ ${table}: rows=${rows}, hash=${sourceHash}`);
    }
  });
  console.log(`✅ public 存量业务数据已复制到 ${tenant.schemaName}；原数据未删除`);
}

main()
  .catch((error) => {
    console.error('❌ legacy public 迁移失败:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
