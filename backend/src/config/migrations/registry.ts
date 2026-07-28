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
  TenantMember,
  MemberRole,
  MemberInvitation,
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
  TenantMember,
  MemberRole,
  MemberInvitation,
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
  {
    id: '003_control_identity',
    scope: 'control',
    description: 'Separate global identity from tenant membership and preserve legacy assignment snapshots',
    checksumSource: 'control:v1:global-role-template:must-change-password:legacy-identity-snapshot',
    up: async (_schemaName, transaction) => {
      await sequelize.query(`ALTER TABLE public.users
        ADD COLUMN IF NOT EXISTS "globalRoleTemplateId" uuid,
        ADD COLUMN IF NOT EXISTS "mustChangePassword" boolean NOT NULL DEFAULT false`, { transaction });
      await sequelize.query(`ALTER TABLE public.role_templates
        ADD COLUMN IF NOT EXISTS "permissionScopes" jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS "systemKey" varchar(60),
        ADD COLUMN IF NOT EXISTS "isLocked" boolean NOT NULL DEFAULT true`, { transaction });
      await sequelize.query(`UPDATE public.role_templates
        SET "systemKey" = 'tenant_admin'
        WHERE name = '管理员' AND "systemKey" IS NULL`, { transaction });
      await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS role_templates_system_key_unique
        ON public.role_templates ("systemKey") WHERE "systemKey" IS NOT NULL`, { transaction });
      await sequelize.query(`CREATE TABLE IF NOT EXISTS public.user_identity_migration_snapshots (
        user_id uuid PRIMARY KEY,
        legacy_tenant_id uuid,
        legacy_role_id uuid,
        legacy_role varchar(30),
        legacy_department varchar(100),
        captured_at timestamptz NOT NULL DEFAULT now()
      )`, { transaction });
      const columns = await sequelize.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users'
           AND column_name IN ('tenantId', 'roleId', 'role', 'department')`,
        { type: QueryTypes.SELECT, transaction },
      );
      const names = new Set(columns.map((column) => column.column_name));
      if (names.has('tenantId') && names.has('roleId')) {
        await sequelize.query(`INSERT INTO public.user_identity_migration_snapshots
          (user_id, legacy_tenant_id, legacy_role_id, legacy_role, legacy_department)
          SELECT id, "tenantId", "roleId",
            ${names.has('role') ? 'role' : 'NULL'},
            ${names.has('department') ? 'department' : 'NULL'}
          FROM public.users
          ON CONFLICT (user_id) DO NOTHING`, { transaction });
        await sequelize.query(`UPDATE public.users
          SET "globalRoleTemplateId" = "roleId"
          WHERE "tenantId" IS NULL AND "globalRoleTemplateId" IS NULL`, { transaction });
      }
    },
    down: async (_schemaName, transaction) => {
      await sequelize.query(`ALTER TABLE public.users
        DROP COLUMN IF EXISTS "mustChangePassword",
        DROP COLUMN IF EXISTS "globalRoleTemplateId"`, { transaction });
      await sequelize.query(`ALTER TABLE public.role_templates
        DROP COLUMN IF EXISTS "isLocked",
        DROP COLUMN IF EXISTS "systemKey",
        DROP COLUMN IF EXISTS "permissionScopes"`, { transaction });
      await sequelize.query('DROP TABLE IF EXISTS public.user_identity_migration_snapshots', { transaction });
    },
  },
  {
    id: '003_tenant_membership',
    scope: 'tenant',
    description: 'Create tenant members, multi-role assignments, governed departments and ownership fields',
    checksumSource: 'tenant:v2:members:member-roles:invitations:department-governance:uuid-primary-selection:business-department-ownership',
    up: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      await TenantMember.schema(schemaName).sync({ transaction } as any);
      await MemberRole.schema(schemaName).sync({ transaction } as any);
      await MemberInvitation.schema(schemaName).sync({ transaction } as any);

      await sequelize.query(`ALTER TABLE ${quoted}.roles
        ADD COLUMN IF NOT EXISTS "permissionScopes" jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS "systemKey" varchar(60),
        ADD COLUMN IF NOT EXISTS "isLocked" boolean NOT NULL DEFAULT false`, { transaction });
      await sequelize.query(`UPDATE ${quoted}.roles
        SET "systemKey" = 'tenant_admin', "isLocked" = true
        WHERE "isSystem" = true AND name = '管理员' AND "systemKey" IS NULL`, { transaction });
      await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS roles_system_key_unique
        ON ${quoted}.roles ("tenantId", "systemKey") WHERE "systemKey" IS NOT NULL`, { transaction });

      await sequelize.query(`ALTER TABLE ${quoted}.departments
        ADD COLUMN IF NOT EXISTS code varchar(60),
        ADD COLUMN IF NOT EXISTS "managerMemberId" uuid,
        ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS "archivedAt" timestamptz`, { transaction });
      await sequelize.query(`UPDATE ${quoted}.departments
        SET code = 'LEGACY_' || upper(substr(replace(id::text, '-', ''), 1, 12))
        WHERE code IS NULL`, { transaction });
      await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS departments_code_unique
        ON ${quoted}.departments (code)`, { transaction });

      await sequelize.query(`ALTER TABLE ${quoted}.department_members
        ADD COLUMN IF NOT EXISTS "memberId" uuid,
        ADD COLUMN IF NOT EXISTS "isPrimary" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "positionTitle" varchar(100),
        ADD COLUMN IF NOT EXISTS "joinedAt" timestamptz NOT NULL DEFAULT now()`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.audit_tasks
        ADD COLUMN IF NOT EXISTS "departmentId" uuid`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.qualifications
        ADD COLUMN IF NOT EXISTS "ownerDepartmentId" uuid,
        ADD COLUMN IF NOT EXISTS "responsibleUserId" uuid`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.audit_logs
        ADD COLUMN IF NOT EXISTS "departmentId" uuid`, { transaction });

      const tenant = await sequelize.query<{ id: string }>(
        'SELECT id FROM public.tenants WHERE "schemaName" = :schemaName',
        { replacements: { schemaName }, type: QueryTypes.SELECT, transaction },
      );
      const tenantId = tenant[0]?.id;
      if (!tenantId) throw new Error(`找不到 schema ${schemaName} 对应的租户`);

      const legacyColumns = await sequelize.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users'
           AND column_name IN ('tenantId', 'roleId')`,
        { type: QueryTypes.SELECT, transaction },
      );
      const legacyNames = new Set(legacyColumns.map((column) => column.column_name));
      if (legacyNames.has('tenantId')) {
        await sequelize.query(`INSERT INTO ${quoted}.tenant_members
          (id, "userId", "displayName", email, status, "sessionVersion", "joinedAt", "createdSource", "createdAt", "updatedAt")
          SELECT gen_random_uuid(), id, username, email, 'active', 1, now(), 'migration', now(), now()
          FROM public.users
          WHERE "tenantId" = :tenantId
          ON CONFLICT ("userId") DO NOTHING`, { replacements: { tenantId }, transaction });
      }
      if (legacyNames.has('roleId')) {
        await sequelize.query(`INSERT INTO ${quoted}.member_roles (id, "memberId", "roleId", "createdAt")
          SELECT gen_random_uuid(), member.id, users."roleId", now()
          FROM public.users users
          JOIN ${quoted}.tenant_members member ON member."userId" = users.id
          JOIN ${quoted}.roles role ON role.id = users."roleId"
          WHERE users."tenantId" = :tenantId AND users."roleId" IS NOT NULL
          ON CONFLICT ("memberId", "roleId") DO NOTHING`, { replacements: { tenantId }, transaction });
      }

      const deptColumns = await sequelize.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = :schemaName AND table_name = 'department_members'
           AND column_name = 'userId'`,
        { replacements: { schemaName }, type: QueryTypes.SELECT, transaction },
      );
      if (deptColumns.length > 0) {
        await sequelize.query(`UPDATE ${quoted}.department_members dm
          SET "memberId" = member.id
          FROM ${quoted}.tenant_members member
          WHERE dm."userId" = member."userId" AND dm."memberId" IS NULL`, { transaction });
        await sequelize.query(`WITH single_department AS (
          SELECT "memberId", min(id::text)::uuid AS row_id
          FROM ${quoted}.department_members
          WHERE "memberId" IS NOT NULL
          GROUP BY "memberId"
          HAVING count(*) = 1
        )
        UPDATE ${quoted}.department_members dm
        SET "isPrimary" = true
        FROM single_department single
        WHERE dm.id = single.row_id`, { transaction });
      }
      await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS department_member_unique_v2
        ON ${quoted}.department_members ("departmentId", "memberId")
        WHERE "memberId" IS NOT NULL`, { transaction });
      await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS member_primary_department_unique
        ON ${quoted}.department_members ("memberId")
        WHERE "isPrimary" = true`, { transaction });
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      await sequelize.query(`DROP INDEX IF EXISTS ${quoted}.member_primary_department_unique`, { transaction });
      await sequelize.query(`DROP INDEX IF EXISTS ${quoted}.department_member_unique_v2`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.audit_logs DROP COLUMN IF EXISTS "departmentId"`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.qualifications
        DROP COLUMN IF EXISTS "responsibleUserId",
        DROP COLUMN IF EXISTS "ownerDepartmentId"`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.audit_tasks DROP COLUMN IF EXISTS "departmentId"`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.department_members
        DROP COLUMN IF EXISTS "joinedAt",
        DROP COLUMN IF EXISTS "positionTitle",
        DROP COLUMN IF EXISTS "isPrimary",
        DROP COLUMN IF EXISTS "memberId"`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.departments
        DROP COLUMN IF EXISTS "archivedAt",
        DROP COLUMN IF EXISTS status,
        DROP COLUMN IF EXISTS "managerMemberId",
        DROP COLUMN IF EXISTS code`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.roles
        DROP COLUMN IF EXISTS "isLocked",
        DROP COLUMN IF EXISTS "systemKey",
        DROP COLUMN IF EXISTS "permissionScopes"`, { transaction });
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.member_invitations`, { transaction });
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.member_roles`, { transaction });
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.tenant_members`, { transaction });
    },
  },
  {
    id: '004_tenant_membership_finalize',
    scope: 'tenant',
    description: 'Enforce complete member, role, department and business ownership assignments',
    checksumSource: 'tenant:v2:membership-final-preflight:risk-task:not-null:drop-legacy-department-user',
    up: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const failures = await sequelize.query<{ problem: string; count: number }>(`
        SELECT 'active_member_without_one_primary_department' AS problem, count(*)::int AS count
        FROM ${quoted}.tenant_members member
        WHERE member.status = 'active'
          AND (SELECT count(*) FROM ${quoted}.department_members dm
               WHERE dm."memberId" = member.id AND dm."isPrimary" = true) <> 1
        UNION ALL
        SELECT 'active_member_without_role', count(*)::int
        FROM ${quoted}.tenant_members member
        WHERE member.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM ${quoted}.member_roles mr WHERE mr."memberId" = member.id)
        UNION ALL
        SELECT 'task_without_department', count(*)::int FROM ${quoted}.audit_tasks WHERE "departmentId" IS NULL
        UNION ALL
        SELECT 'qualification_without_department', count(*)::int FROM ${quoted}.qualifications WHERE "ownerDepartmentId" IS NULL
        UNION ALL
        SELECT 'risk_without_task', count(*)::int FROM ${quoted}.risk_records WHERE "taskId" IS NULL
        UNION ALL
        SELECT 'legacy_department_member_without_member', count(*)::int
        FROM ${quoted}.department_members WHERE "memberId" IS NULL
      `, { type: QueryTypes.SELECT, transaction });
      const unresolved = failures.filter((failure) => Number(failure.count) > 0);
      if (unresolved.length > 0) {
        throw new Error(`成员治理迁移仍有未映射数据: ${unresolved.map((item) => `${item.problem}=${item.count}`).join(', ')}`);
      }
      await sequelize.query(`ALTER TABLE ${quoted}.departments ALTER COLUMN code SET NOT NULL`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.department_members ALTER COLUMN "memberId" SET NOT NULL`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.audit_tasks ALTER COLUMN "departmentId" SET NOT NULL`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.qualifications ALTER COLUMN "ownerDepartmentId" SET NOT NULL`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.risk_records ALTER COLUMN "taskId" SET NOT NULL`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.department_members DROP COLUMN IF EXISTS "userId"`, { transaction });
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      await sequelize.query(`ALTER TABLE ${quoted}.department_members ADD COLUMN IF NOT EXISTS "userId" uuid`, { transaction });
      await sequelize.query(`UPDATE ${quoted}.department_members dm
        SET "userId" = member."userId"
        FROM ${quoted}.tenant_members member
        WHERE dm."memberId" = member.id`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.qualifications ALTER COLUMN "ownerDepartmentId" DROP NOT NULL`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.risk_records ALTER COLUMN "taskId" DROP NOT NULL`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.audit_tasks ALTER COLUMN "departmentId" DROP NOT NULL`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.department_members ALTER COLUMN "memberId" DROP NOT NULL`, { transaction });
    },
  },
  {
    id: '004_control_identity_finalize',
    scope: 'control',
    description: 'Remove legacy tenant, role and department fields from global identities',
    checksumSource: 'control:v1:drop-legacy-user-membership-columns:restorable-snapshot',
    up: async (_schemaName, transaction) => {
      await sequelize.query(`ALTER TABLE public.users
        DROP COLUMN IF EXISTS department,
        DROP COLUMN IF EXISTS role,
        DROP COLUMN IF EXISTS "roleId",
        DROP COLUMN IF EXISTS "tenantId"`, { transaction });
    },
    down: async (_schemaName, transaction) => {
      await sequelize.query(`ALTER TABLE public.users
        ADD COLUMN IF NOT EXISTS department varchar(100),
        ADD COLUMN IF NOT EXISTS role varchar(30),
        ADD COLUMN IF NOT EXISTS "roleId" uuid,
        ADD COLUMN IF NOT EXISTS "tenantId" uuid`, { transaction });
      await sequelize.query(`UPDATE public.users users
        SET department = snapshot.legacy_department,
            role = snapshot.legacy_role,
            "roleId" = snapshot.legacy_role_id,
            "tenantId" = snapshot.legacy_tenant_id
        FROM public.user_identity_migration_snapshots snapshot
        WHERE snapshot.user_id = users.id`, { transaction });
    },
  },
];

export function migrationChecksum(migration: Migration): string {
  return createHash('sha256')
    .update(`${migration.id}\n${migration.scope}\n${migration.description}\n${migration.checksumSource}`)
    .digest('hex');
}

export default migrations;
