#!/usr/bin/env node
import { QueryTypes } from 'sequelize';
import sequelize from './database';
import Tenant from '../models/Tenant';
import { migrateUp } from './migrations/runner';
import { importLegacyTables } from './migrations/legacy-risk-compat';

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

  const verified = await importLegacyTables(sequelize, tenant.schemaName, tenant.id, report);
  for (const result of verified) console.log(`✓ ${result.table}: rows=${result.rows}, hash=${result.hash}`);
  console.log(`✅ public 存量业务数据已复制到 ${tenant.schemaName}；原数据未删除`);
}

main()
  .catch((error) => {
    console.error('❌ legacy public 迁移失败:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
