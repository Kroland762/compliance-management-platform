import { createHash } from 'crypto';
import { QueryTypes, type Transaction } from 'sequelize';
import sequelize from '../database';
import User from '../../models/User';
import Tenant from '../../models/Tenant';
import RoleTemplate from '../../models/RoleTemplate';
import ControlAuditEvent from '../../models/ControlAuditEvent';
import TaskSchedule from '../../models/TaskSchedule';
import { runWithTenantContext } from '../../middlewares/tenant';
import '../../models';
import '../../models/account';
import '../../models/account/associations';
import {
  AuditLog,
  AuditTask,
  Department,
  DepartmentMember,
  EvidenceFile,
  Notification,
  Qualification,
  QuestionItem,
  QuestionnaireTemplate,
  QuestionTemplate,
  RiskRecord,
  Role,
  SystemSetting,
} from '../../models';
import {
  AccountAuditTask,
  AccountData,
  AuditRule,
  DataSource,
  ProblemAccount,
  TaskExecution,
} from '../../models/account';

export interface Migration {
  id: string;
  scope: 'control' | 'tenant';
  description: string;
  checksumSource: string;
  up: (schemaName: string, transaction: Transaction) => Promise<void>;
  down?: (schemaName: string, transaction: Transaction) => Promise<void>;
}

const controlModels = [Tenant, RoleTemplate, User, ControlAuditEvent, TaskSchedule];
const tenantModels = [
  Role,
  Department,
  QuestionnaireTemplate,
  QuestionTemplate,
  AuditTask,
  QuestionItem,
  EvidenceFile,
  RiskRecord,
  Notification,
  AuditLog,
  Qualification,
  SystemSetting,
  DepartmentMember,
  DataSource,
  AccountData,
  AuditRule,
  AccountAuditTask,
  ProblemAccount,
  TaskExecution,
];

const migrations: Migration[] = [
  {
    id: '001_control_plane',
    scope: 'control',
    description: 'Create users, tenants, role templates and control audit events',
    checksumSource: 'control:v2:users,tenants,role_templates,control_audit_events,task_schedules',
    up: async (_schemaName, transaction) => {
      for (const model of controlModels) {
        await model.sync({ transaction } as any);
      }
    },
  },
  {
    id: '001_tenant_business',
    scope: 'tenant',
    description: 'Create the complete tenant business schema',
    checksumSource: 'tenant:v6:legacy-role-preflight:explicit-schema-sync:dependency-ordered-business-models:string-status-columns',
    up: async (schemaName, transaction) => {
      const [roleTable] = await sequelize.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = :schemaName AND table_name = 'roles'
        ) AS exists`,
        { replacements: { schemaName }, type: QueryTypes.SELECT, transaction },
      );
      if (roleTable?.exists) {
        const quoted = `"${schemaName.replace(/"/g, '""')}"`;
        await sequelize.query(`ALTER TABLE ${quoted}.roles ADD COLUMN IF NOT EXISTS "tenantId" uuid`, { transaction });
        await sequelize.query(`UPDATE ${quoted}.roles
          SET "tenantId" = (
            SELECT id FROM public.tenants WHERE "schemaName" = :schemaName
          )
          WHERE "tenantId" IS NULL`, { replacements: { schemaName }, transaction });
        await sequelize.query(`ALTER TABLE ${quoted}.roles ALTER COLUMN "tenantId" SET NOT NULL`, { transaction });
      }
      await runWithTenantContext({ schema: schemaName, tenantId: null }, async () => {
        for (const model of tenantModels) {
          await (model as any).schema(schemaName).sync({ transaction } as any);
        }
      });
    },
  },
  {
    id: '002_tenant_security_fields',
    scope: 'tenant',
    description: 'Add evidence integrity and scheduler recovery fields',
    checksumSource: 'tenant:v5:role-tenant-ownership:evidence-legacy-nullability:storage-hash-status-type:scheduler-heartbeat-idempotency-retry:department-root-uniqueness:reversible',
    up: async (schemaName, transaction) => {
      const q = (sql: string, replacements?: Record<string, unknown>) =>
        sequelize.query(sql, { transaction, replacements });
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      await q(`ALTER TABLE ${quoted}.roles ADD COLUMN IF NOT EXISTS "tenantId" uuid`);
      await q(`UPDATE ${quoted}.roles
        SET "tenantId" = (
          SELECT id FROM public.tenants WHERE "schemaName" = :schemaName
        )
        WHERE "tenantId" IS NULL`, { schemaName });
      const [unowned] = await q(`SELECT count(*)::int AS count FROM ${quoted}.roles WHERE "tenantId" IS NULL`);
      if (Number((unowned as any[])[0]?.count || 0) > 0) {
        throw new Error(`${schemaName}.roles 存在无法确定租户归属的记录`);
      }
      await q(`ALTER TABLE ${quoted}.roles ALTER COLUMN "tenantId" SET NOT NULL`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS roles_tenant_name_unique
        ON ${quoted}.roles ("tenantId", "name")`);
      await q(`ALTER TABLE ${quoted}.evidence_files
        ADD COLUMN IF NOT EXISTS "storageKey" varchar(500),
        ADD COLUMN IF NOT EXISTS "sha256" varchar(64),
        ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz,
        ADD COLUMN IF NOT EXISTS "evidenceType" varchar(20) NOT NULL DEFAULT 'current'`);
      await q(`ALTER TABLE ${quoted}.evidence_files
        ALTER COLUMN "filePath" DROP NOT NULL,
        ALTER COLUMN "storedFilename" DROP NOT NULL`);
      await q(`CREATE INDEX IF NOT EXISTS evidence_files_status_idx ON ${quoted}.evidence_files ("status")`);
      await q(`ALTER TABLE ${quoted}.account_task_executions
        ADD COLUMN IF NOT EXISTS "heartbeatAt" timestamptz,
        ADD COLUMN IF NOT EXISTS "workerId" varchar(100),
        ADD COLUMN IF NOT EXISTS "idempotencyKey" varchar(180),
        ADD COLUMN IF NOT EXISTS "attempt" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "nextRetryAt" timestamptz`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS account_task_executions_idempotency_idx
        ON ${quoted}.account_task_executions ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS departments_parent_name_unique
        ON ${quoted}.departments (
          COALESCE("parentId", '00000000-0000-0000-0000-000000000000'::uuid),
          "name"
        )`);
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      await sequelize.query(`DROP INDEX IF EXISTS ${quoted}.account_task_executions_idempotency_idx`, { transaction });
      await sequelize.query(`DROP INDEX IF EXISTS ${quoted}.departments_parent_name_unique`, { transaction });
      await sequelize.query(`DROP INDEX IF EXISTS ${quoted}.roles_tenant_name_unique`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.account_task_executions
        DROP COLUMN IF EXISTS "heartbeatAt",
        DROP COLUMN IF EXISTS "workerId",
        DROP COLUMN IF EXISTS "idempotencyKey",
        DROP COLUMN IF EXISTS "attempt",
        DROP COLUMN IF EXISTS "nextRetryAt"`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.evidence_files
        DROP COLUMN IF EXISTS "storageKey",
        DROP COLUMN IF EXISTS "sha256",
        DROP COLUMN IF EXISTS "status",
        DROP COLUMN IF EXISTS "deletedAt",
        DROP COLUMN IF EXISTS "evidenceType"`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.roles DROP COLUMN IF EXISTS "tenantId"`, { transaction });
    },
  },
];

export function migrationChecksum(migration: Migration): string {
  return createHash('sha256')
    .update(`${migration.id}\n${migration.scope}\n${migration.description}\n${migration.checksumSource}`)
    .digest('hex');
}

export default migrations;
