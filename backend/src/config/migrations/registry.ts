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
  Asset,
  AssessmentAsset,
  AssessmentControlAsset,
  RiskSource,
  RiskAffectedAsset,
  RemediationAction,
  RiskActionLink,
  AssessmentPlan,
  AssessmentPlanExecution,
  IdempotencyRecord,
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
  Asset,
  AuditTask,
  QuestionItem,
  AssessmentAsset,
  AssessmentControlAsset,
  RiskRecord,
  RiskSource,
  RiskAffectedAsset,
  RemediationAction,
  RiskActionLink,
  EvidenceFile,
  AssessmentPlan,
  AssessmentPlanExecution,
  IdempotencyRecord,
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
  {
    id: '005_control_schedule_resources',
    scope: 'control',
    description: 'Generalize persistent schedules for account audits and assessment plans',
    checksumSource: 'control:v1:task-schedules:resource-type:resource-id:legacy-account-audit-backfill',
    up: async (_schemaName, transaction) => {
      await sequelize.query(`ALTER TABLE public.task_schedules
        ADD COLUMN IF NOT EXISTS "resourceType" varchar(30),
        ADD COLUMN IF NOT EXISTS "resourceId" uuid`, { transaction });
      await sequelize.query(`UPDATE public.task_schedules
        SET "resourceType" = COALESCE("resourceType", 'account_audit'),
            "resourceId" = COALESCE("resourceId", "taskId")
        WHERE "resourceType" IS NULL OR "resourceId" IS NULL`, { transaction });
      await sequelize.query(`ALTER TABLE public.task_schedules
        ALTER COLUMN "resourceType" SET DEFAULT 'account_audit',
        ALTER COLUMN "resourceType" SET NOT NULL,
        ALTER COLUMN "resourceId" SET NOT NULL,
        ALTER COLUMN "taskId" DROP NOT NULL`, { transaction });
      await sequelize.query('DROP INDEX IF EXISTS public.task_schedules_tenant_id_task_id', { transaction });
      await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS task_schedules_resource_unique
        ON public.task_schedules ("tenantId", "resourceType", "resourceId")`, { transaction });
    },
    down: async (_schemaName, transaction) => {
      const unresolved = await sequelize.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM public.task_schedules
        WHERE "resourceType" <> 'account_audit' OR "taskId" IS NULL
      `, { type: QueryTypes.SELECT, transaction });
      if (Number(unresolved[0]?.count || 0) > 0) {
        throw new Error('存在评估计划调度记录，不能回滚为账户审计专用结构');
      }
      await sequelize.query('DROP INDEX IF EXISTS public.task_schedules_resource_unique', { transaction });
      await sequelize.query(`ALTER TABLE public.task_schedules
        ALTER COLUMN "taskId" SET NOT NULL,
        DROP COLUMN IF EXISTS "resourceType",
        DROP COLUMN IF EXISTS "resourceId"`, { transaction });
    },
  },
  {
    id: '005_assessment_asset_graph',
    scope: 'tenant',
    description: 'Create assets, assessment scopes and asset-scoped control evaluations',
    checksumSource: 'tenant:v2:assets:assessment-assets:control-evaluations:snapshots:org-governance:legacy-table-recovery',
    up: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const q = (sql: string, replacements?: Record<string, unknown>) =>
        sequelize.query(sql, { transaction, replacements });
      await q('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      // Some early installations only recorded the membership tables in the
      // baseline migration. Recreate missing standard/control tables before
      // snapshotting, while leaving existing populated tables untouched.
      await runWithTenantContext({ schema: schemaName, tenantId: null }, async () => {
        await QuestionnaireTemplate.schema(schemaName).sync({ transaction } as any);
        await QuestionTemplate.schema(schemaName).sync({ transaction } as any);
      });
      await q(`ALTER TABLE ${quoted}.audit_tasks
        ADD COLUMN IF NOT EXISTS "templateId" uuid,
        ADD COLUMN IF NOT EXISTS "assessmentType" varchar(100),
        ADD COLUMN IF NOT EXISTS "assessmentTarget" varchar(200),
        ADD COLUMN IF NOT EXISTS "createdBy" uuid,
        ADD COLUMN IF NOT EXISTS "assignedTo" uuid,
        ADD COLUMN IF NOT EXISTS "reviewerId" uuid,
        ADD COLUMN IF NOT EXISTS status varchar(30) NOT NULL DEFAULT 'draft',
        ADD COLUMN IF NOT EXISTS "returnReason" text,
        ADD COLUMN IF NOT EXISTS "returnedAssignees" jsonb,
        ADD COLUMN IF NOT EXISTS "createdAt" timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "submittedAt" timestamptz,
        ADD COLUMN IF NOT EXISTS "reviewedAt" timestamptz`);
      await runWithTenantContext({ schema: schemaName, tenantId: null }, async () => {
        await Asset.schema(schemaName).sync({ transaction } as any);
        await QuestionItem.schema(schemaName).sync({ transaction } as any);
      });
      await q(`CREATE TABLE IF NOT EXISTS ${quoted}.relationship_migration_snapshots (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type varchar(40) NOT NULL,
        entity_id uuid NOT NULL,
        payload jsonb NOT NULL,
        checksum varchar(64) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (entity_type, entity_id)
      )`);
      await q(`INSERT INTO ${quoted}.relationship_migration_snapshots
        (entity_type, entity_id, payload, checksum)
        SELECT 'audit_task', id, to_jsonb(source),
          encode(digest(convert_to(to_jsonb(source)::text, 'UTF8'), 'sha256'), 'hex')
        FROM ${quoted}.audit_tasks source
        ON CONFLICT (entity_type, entity_id) DO NOTHING`);
      await q(`INSERT INTO ${quoted}.relationship_migration_snapshots
        (entity_type, entity_id, payload, checksum)
        SELECT 'question_item', id, to_jsonb(source),
          encode(digest(convert_to(to_jsonb(source)::text, 'UTF8'), 'sha256'), 'hex')
        FROM ${quoted}.question_items source
        ON CONFLICT (entity_type, entity_id) DO NOTHING`);

      await runWithTenantContext({ schema: schemaName, tenantId: null }, async () => {
        await AssessmentAsset.schema(schemaName).sync({ transaction } as any);
        await AssessmentControlAsset.schema(schemaName).sync({ transaction } as any);
      });
      await q(`INSERT INTO ${quoted}.assets
        (id, code, name, "assetType", criticality, description, metadata, status, "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), 'ORG-GOVERNANCE', '组织级治理', 'organization', 'high',
          '系统内置逻辑资产，用于不对应具体技术资产的流程与治理控制项',
          '{}'::jsonb, 'active', now(), now())
        ON CONFLICT (code) DO NOTHING`);
      await q(`ALTER TABLE ${quoted}.audit_tasks
        ADD COLUMN IF NOT EXISTS name varchar(200),
        ADD COLUMN IF NOT EXISTS "periodStart" date,
        ADD COLUMN IF NOT EXISTS "periodEnd" date,
        ADD COLUMN IF NOT EXISTS "publishedAt" timestamptz,
        ADD COLUMN IF NOT EXISTS "cancelledAt" timestamptz,
        ADD COLUMN IF NOT EXISTS "lockVersion" integer NOT NULL DEFAULT 0`);
      await q(`UPDATE ${quoted}.audit_tasks
        SET name = COALESCE(NULLIF(name, ''), "assessmentTarget", '未命名评估')
        WHERE name IS NULL OR name = ''`);
      await q(`ALTER TABLE ${quoted}.audit_tasks ALTER COLUMN name SET NOT NULL`);

      await q(`ALTER TABLE ${quoted}.question_items
        ADD COLUMN IF NOT EXISTS "assetId" uuid,
        ADD COLUMN IF NOT EXISTS "responsibleDepartmentId" uuid,
        ADD COLUMN IF NOT EXISTS "workflowStatus" varchar(30) NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS "submittedAt" timestamptz,
        ADD COLUMN IF NOT EXISTS "reviewedBy" uuid,
        ADD COLUMN IF NOT EXISTS "lockVersion" integer NOT NULL DEFAULT 0`);
      await q(`UPDATE ${quoted}.question_items
        SET "workflowStatus" = CASE
          WHEN "reviewedAt" IS NOT NULL THEN 'reviewed'
          WHEN "answerStatus" = 'answered' THEN 'in_progress'
          ELSE 'pending'
        END,
        "complianceStatus" = CASE
          WHEN "complianceStatus" = 'partially_compliant' THEN 'partial'
          ELSE COALESCE("complianceStatus", 'not_assessed')
        END`);
      await q(`ALTER TABLE ${quoted}.question_items
        ALTER COLUMN "complianceStatus" SET DEFAULT 'not_assessed',
        ALTER COLUMN "complianceStatus" SET NOT NULL`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS control_evaluation_task_control_asset_unique
        ON ${quoted}.question_items ("taskId", "templateQuestionId", "assetId")
        WHERE "assetId" IS NOT NULL`);
      await q(`CREATE INDEX IF NOT EXISTS control_evaluation_asset_idx
        ON ${quoted}.question_items ("assetId")`);
      await q(`CREATE INDEX IF NOT EXISTS control_evaluation_assignee_status_idx
        ON ${quoted}.question_items ("assignedTo", "workflowStatus")`);
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      await sequelize.query(`DROP INDEX IF EXISTS ${quoted}.control_evaluation_assignee_status_idx`, { transaction });
      await sequelize.query(`DROP INDEX IF EXISTS ${quoted}.control_evaluation_asset_idx`, { transaction });
      await sequelize.query(`DROP INDEX IF EXISTS ${quoted}.control_evaluation_task_control_asset_unique`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.question_items
        DROP COLUMN IF EXISTS "lockVersion",
        DROP COLUMN IF EXISTS "reviewedBy",
        DROP COLUMN IF EXISTS "submittedAt",
        DROP COLUMN IF EXISTS "workflowStatus",
        DROP COLUMN IF EXISTS "responsibleDepartmentId",
        DROP COLUMN IF EXISTS "assetId"`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.audit_tasks
        DROP COLUMN IF EXISTS "lockVersion",
        DROP COLUMN IF EXISTS "cancelledAt",
        DROP COLUMN IF EXISTS "publishedAt",
        DROP COLUMN IF EXISTS "periodEnd",
        DROP COLUMN IF EXISTS "periodStart",
        DROP COLUMN IF EXISTS name`, { transaction });
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.assessment_assets`, { transaction });
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.assessment_control_assets`, { transaction });
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.assets`, { transaction });
    },
  },
  {
    id: '006_risk_remediation_graph',
    scope: 'tenant',
    description: 'Create risk sources, affected assets, remediation actions and per-risk verification',
    checksumSource: 'tenant:v3:risk-graph:remediation-graph:evidence-parent-check:sequences:legacy-snapshots:permissions',
    up: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const q = (sql: string, replacements?: Record<string, unknown>) =>
        sequelize.query(sql, { transaction, replacements });
      await q('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      await q(`ALTER TABLE ${quoted}.risk_records
        ADD COLUMN IF NOT EXISTS "questionItemId" uuid,
        ADD COLUMN IF NOT EXISTS "assessmentType" varchar(100),
        ADD COLUMN IF NOT EXISTS "assessmentTarget" varchar(200),
        ADD COLUMN IF NOT EXISTS "riskIdentification" varchar(100),
        ADD COLUMN IF NOT EXISTS "riskLevel" varchar(20) NOT NULL DEFAULT 'low',
        ADD COLUMN IF NOT EXISTS "remediationMeasures" varchar(500),
        ADD COLUMN IF NOT EXISTS "remediationStatus" varchar(30),
        ADD COLUMN IF NOT EXISTS "riskStatus" varchar(30),
        ADD COLUMN IF NOT EXISTS "identifiedAt" timestamptz NOT NULL DEFAULT now()`);
      await q(`INSERT INTO ${quoted}.relationship_migration_snapshots
        (entity_type, entity_id, payload, checksum)
        SELECT 'risk_record', id, to_jsonb(source),
          encode(digest(convert_to(to_jsonb(source)::text, 'UTF8'), 'sha256'), 'hex')
        FROM ${quoted}.risk_records source
        ON CONFLICT (entity_type, entity_id) DO NOTHING`);
      await q(`CREATE SEQUENCE IF NOT EXISTS ${quoted}.risk_code_seq`);
      await q(`CREATE SEQUENCE IF NOT EXISTS ${quoted}.remediation_action_code_seq`);
      await q(`ALTER TABLE ${quoted}.risk_records
        ADD COLUMN IF NOT EXISTS code varchar(32),
        ADD COLUMN IF NOT EXISTS title varchar(200),
        ADD COLUMN IF NOT EXISTS description text,
        ADD COLUMN IF NOT EXISTS "treatmentStrategy" varchar(20),
        ADD COLUMN IF NOT EXISTS "ownerDepartmentId" uuid,
        ADD COLUMN IF NOT EXISTS "ownerUserId" uuid,
        ADD COLUMN IF NOT EXISTS "dueDate" date,
        ADD COLUMN IF NOT EXISTS status varchar(24),
        ADD COLUMN IF NOT EXISTS "confirmedBy" uuid,
        ADD COLUMN IF NOT EXISTS "confirmedAt" timestamptz,
        ADD COLUMN IF NOT EXISTS "acceptedBy" uuid,
        ADD COLUMN IF NOT EXISTS "acceptedAt" timestamptz,
        ADD COLUMN IF NOT EXISTS "acceptanceReason" text,
        ADD COLUMN IF NOT EXISTS "reviewDueDate" date,
        ADD COLUMN IF NOT EXISTS "closedBy" uuid,
        ADD COLUMN IF NOT EXISTS "closedAt" timestamptz,
        ADD COLUMN IF NOT EXISTS "closeComment" text,
        ADD COLUMN IF NOT EXISTS "lockVersion" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "createdAt" timestamptz,
        ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz`);
      await q(`UPDATE ${quoted}.risk_records risk
        SET code = COALESCE(risk.code,
              'RISK-' || to_char(CURRENT_DATE, 'YYYYMM') || '-' ||
              lpad(nextval('${schemaName.replace(/'/g, "''")}.risk_code_seq')::text, 6, '0')),
            title = COALESCE(risk.title, NULLIF(risk."riskIdentification", ''), '历史风险'),
            description = COALESCE(risk.description, NULLIF(risk."riskIdentification", ''), '历史风险'),
            "treatmentStrategy" = COALESCE(risk."treatmentStrategy", CASE risk."riskStatus"
              WHEN 'risk_acceptance' THEN 'accept'
              WHEN 'risk_transfer' THEN 'transfer'
              WHEN 'risk_elimination' THEN 'avoid'
              ELSE 'mitigate' END),
            "ownerDepartmentId" = COALESCE(risk."ownerDepartmentId", task."departmentId"),
            "ownerUserId" = COALESCE(risk."ownerUserId", task."assignedTo", task."createdBy"),
            status = COALESCE(risk.status, CASE risk."remediationStatus"
              WHEN 'remediated' THEN 'pending_verification'
              WHEN 'in_progress' THEN 'remediating'
              ELSE 'open' END),
            "createdAt" = COALESCE(risk."createdAt", risk."identifiedAt", now()),
            "updatedAt" = COALESCE(risk."updatedAt", now())
        FROM ${quoted}.audit_tasks task
        WHERE risk."taskId" = task.id`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS risk_records_code_unique ON ${quoted}.risk_records (code)`);

      await runWithTenantContext({ schema: schemaName, tenantId: null }, async () => {
        await RiskSource.schema(schemaName).sync({ transaction } as any);
        await RiskAffectedAsset.schema(schemaName).sync({ transaction } as any);
        await RemediationAction.schema(schemaName).sync({ transaction } as any);
        await RiskActionLink.schema(schemaName).sync({ transaction } as any);
        await EvidenceFile.schema(schemaName).sync({ transaction } as any);
      });
      await q(`ALTER TABLE ${quoted}.evidence_files
        ADD COLUMN IF NOT EXISTS "remediationActionId" uuid,
        ADD COLUMN IF NOT EXISTS "evidencePurpose" varchar(30) NOT NULL DEFAULT 'assessment_current',
        ALTER COLUMN "questionItemId" DROP NOT NULL`);
      await q(`UPDATE ${quoted}.evidence_files
        SET "evidencePurpose" = CASE
          WHEN "evidenceType" = 'historical' THEN 'assessment_historical'
          ELSE 'assessment_current' END
        WHERE "remediationActionId" IS NULL`);
      await q(`CREATE INDEX IF NOT EXISTS evidence_remediation_action_idx
        ON ${quoted}.evidence_files ("remediationActionId", status)`);
      await q(`UPDATE ${quoted}.roles SET
        permissions = permissions || '{
          "assets":["create","read","update","archive"],
          "evaluations":["read","answer","submit","review"],
          "risks":["create","read","update","confirm","assign","accept","verify","close","export"],
          "remediation_actions":["create","read","update","submit","verify","link"],
          "assessment_plans":["create","read","update","delete","execute"]
        }'::jsonb,
        "permissionScopes" = "permissionScopes" || '{
          "assets":{"create":"all","read":"all","update":"all","archive":"all"},
          "evaluations":{"read":"all","answer":"all","submit":"all","review":"all"},
          "risks":{"create":"all","read":"all","update":"all","confirm":"all","assign":"all","accept":"all","verify":"all","close":"all","export":"all"},
          "remediation_actions":{"create":"all","read":"all","update":"all","submit":"all","verify":"all","link":"all"},
          "assessment_plans":{"create":"all","read":"all","update":"all","delete":"all","execute":"all"}
        }'::jsonb
        WHERE "systemKey" = 'tenant_admin'`);
      await q(`UPDATE ${quoted}.roles SET
        permissions = permissions || '{
          "assets":["read"],
          "evaluations":["read","answer","submit","review"],
          "risks":["create","read","update","confirm","assign","accept","verify","close","export"],
          "remediation_actions":["create","read","update","submit","verify","link"],
          "assessment_plans":["create","read","update","execute"]
        }'::jsonb,
        "permissionScopes" = "permissionScopes" || '{
          "assets":{"read":"assigned"},
          "evaluations":{"read":"assigned","answer":"assigned","submit":"assigned","review":"assigned"},
          "risks":{"create":"assigned","read":"assigned","update":"assigned","confirm":"assigned","assign":"assigned","accept":"assigned","verify":"assigned","close":"assigned","export":"assigned"},
          "remediation_actions":{"create":"assigned","read":"assigned","update":"assigned","submit":"assigned","verify":"assigned","link":"assigned"},
          "assessment_plans":{"create":"assigned","read":"assigned","update":"assigned","execute":"assigned"}
        }'::jsonb
        WHERE "systemKey" = 'auditor'`);
      await q(`UPDATE ${quoted}.roles SET
        permissions = permissions || '{
          "assets":["read"],
          "evaluations":["read","answer","submit"],
          "risks":["read"],
          "remediation_actions":["read","update","submit"]
        }'::jsonb,
        "permissionScopes" = "permissionScopes" || '{
          "assets":{"read":"assigned"},
          "evaluations":{"read":"assigned","answer":"assigned","submit":"assigned"},
          "risks":{"read":"assigned"},
          "remediation_actions":{"read":"assigned","update":"assigned","submit":"assigned"}
        }'::jsonb
        WHERE "systemKey" = 'member'`);
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const actionEvidence = await sequelize.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM ${quoted}.evidence_files
        WHERE "remediationActionId" IS NOT NULL
      `, { type: QueryTypes.SELECT, transaction });
      if (Number(actionEvidence[0]?.count || 0) > 0) {
        throw new Error('存在整改证据，不能直接回滚风险整改关系');
      }
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.risk_action_links`, { transaction });
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.remediation_actions`, { transaction });
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.risk_affected_assets`, { transaction });
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.risk_sources`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.evidence_files
        ALTER COLUMN "questionItemId" SET NOT NULL,
        DROP COLUMN IF EXISTS "evidencePurpose",
        DROP COLUMN IF EXISTS "remediationActionId"`, { transaction });
      await sequelize.query(`DROP SEQUENCE IF EXISTS ${quoted}.remediation_action_code_seq`, { transaction });
      await sequelize.query(`DROP SEQUENCE IF EXISTS ${quoted}.risk_code_seq`, { transaction });
    },
  },
  {
    id: '007_assessment_plans',
    scope: 'tenant',
    description: 'Create recurring assessment plans and execution history',
    checksumSource: 'tenant:v1:assessment-plans:snapshots:executions:idempotency',
    up: async (schemaName, transaction) => {
      await runWithTenantContext({ schema: schemaName, tenantId: null }, async () => {
        await AssessmentPlan.schema(schemaName).sync({ transaction } as any);
        await AssessmentPlanExecution.schema(schemaName).sync({ transaction } as any);
      });
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.assessment_plan_executions`, { transaction });
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.assessment_plans`, { transaction });
    },
  },
  {
    id: '008_relationship_graph_finalize',
    scope: 'tenant',
    description: 'Enforce complete assessment, risk and remediation graph mappings',
    checksumSource: 'tenant:v1:relationship-finalize:preflight:not-null:foreign-keys:drop-single-risk-fields',
    up: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const failures = await sequelize.query<{ problem: string; count: number }>(`
        SELECT 'evaluation_without_asset' AS problem, count(*)::int AS count
          FROM ${quoted}.question_items WHERE "assetId" IS NULL
        UNION ALL
        SELECT 'evaluation_without_department', count(*)::int
          FROM ${quoted}.question_items WHERE "responsibleDepartmentId" IS NULL
        UNION ALL
        SELECT 'risk_without_source', count(*)::int
          FROM ${quoted}.risk_records risk
          WHERE NOT EXISTS (SELECT 1 FROM ${quoted}.risk_sources source WHERE source."riskId" = risk.id)
        UNION ALL
        SELECT 'risk_without_affected_asset', count(*)::int
          FROM ${quoted}.risk_records risk
          WHERE NOT EXISTS (SELECT 1 FROM ${quoted}.risk_affected_assets affected WHERE affected."riskId" = risk.id)
        UNION ALL
        SELECT 'risk_without_owner', count(*)::int
          FROM ${quoted}.risk_records WHERE "ownerDepartmentId" IS NULL OR "ownerUserId" IS NULL
      `, { type: QueryTypes.SELECT, transaction });
      const unresolved = failures.filter((failure) => Number(failure.count) > 0);
      if (unresolved.length > 0) {
        throw new Error(`关系图迁移仍有未映射数据: ${unresolved.map((item) => `${item.problem}=${item.count}`).join(', ')}`);
      }
      await sequelize.query(`ALTER TABLE ${quoted}.question_items
        ALTER COLUMN "assetId" SET NOT NULL,
        ALTER COLUMN "responsibleDepartmentId" SET NOT NULL`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.risk_records
        ALTER COLUMN code SET NOT NULL,
        ALTER COLUMN title SET NOT NULL,
        ALTER COLUMN description SET NOT NULL,
        ALTER COLUMN "treatmentStrategy" SET NOT NULL,
        ALTER COLUMN "ownerDepartmentId" SET NOT NULL,
        ALTER COLUMN "ownerUserId" SET NOT NULL,
        ALTER COLUMN status SET NOT NULL,
        ALTER COLUMN "createdAt" SET NOT NULL,
        ALTER COLUMN "updatedAt" SET NOT NULL`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.evidence_files
        DROP CONSTRAINT IF EXISTS evidence_files_exactly_one_parent,
        ADD CONSTRAINT evidence_files_exactly_one_parent CHECK (
          (CASE WHEN "questionItemId" IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN "remediationActionId" IS NULL THEN 0 ELSE 1 END) = 1
        )`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.risk_records
        DROP COLUMN IF EXISTS "questionItemId",
        DROP COLUMN IF EXISTS "assessmentType",
        DROP COLUMN IF EXISTS "assessmentTarget",
        DROP COLUMN IF EXISTS "riskIdentification",
        DROP COLUMN IF EXISTS "remediationMeasures",
        DROP COLUMN IF EXISTS "remediationStatus",
        DROP COLUMN IF EXISTS "riskStatus"`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.question_items
        DROP COLUMN IF EXISTS "riskIdentification",
        DROP COLUMN IF EXISTS "riskLevel",
        DROP COLUMN IF EXISTS "remediationMeasures"`, { transaction });
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      await sequelize.query(`ALTER TABLE ${quoted}.question_items
        ALTER COLUMN "assetId" DROP NOT NULL,
        ALTER COLUMN "responsibleDepartmentId" DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS "riskIdentification" varchar(100),
        ADD COLUMN IF NOT EXISTS "riskLevel" varchar(20),
        ADD COLUMN IF NOT EXISTS "remediationMeasures" varchar(500)`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.evidence_files
        DROP CONSTRAINT IF EXISTS evidence_files_exactly_one_parent`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.risk_records
        ADD COLUMN IF NOT EXISTS "questionItemId" uuid,
        ADD COLUMN IF NOT EXISTS "assessmentType" varchar(100),
        ADD COLUMN IF NOT EXISTS "assessmentTarget" varchar(200),
        ADD COLUMN IF NOT EXISTS "riskIdentification" varchar(100),
        ADD COLUMN IF NOT EXISTS "remediationMeasures" varchar(500),
        ADD COLUMN IF NOT EXISTS "remediationStatus" varchar(30),
        ADD COLUMN IF NOT EXISTS "riskStatus" varchar(30)`, { transaction });
    },
  },
  {
    id: '009_relationship_graph_hardening',
    scope: 'tenant',
    description: 'Add durable API idempotency records for relationship graph commands',
    checksumSource: 'tenant:v3:relationship-graph-idempotency-records:nullable-notification-task:structured-audit:partial-legacy-safe',
    up: async (schemaName, transaction) => {
      await runWithTenantContext({ schema: schemaName, tenantId: null }, async () => {
        await IdempotencyRecord.schema(schemaName).sync({ transaction } as any);
      });
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const tables = await sequelize.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = :schemaName
            AND table_name IN ('notifications', 'audit_logs', 'question_items')`,
        { replacements: { schemaName }, type: QueryTypes.SELECT, transaction },
      );
      const present = new Set(tables.map((row) => row.table_name));
      if (present.has('notifications')) {
        await sequelize.query(`ALTER TABLE ${quoted}.notifications
          ALTER COLUMN "taskId" DROP NOT NULL`, { transaction });
      }
      if (present.has('audit_logs')) {
        await sequelize.query(`ALTER TABLE ${quoted}.audit_logs
          ADD COLUMN IF NOT EXISTS "eventType" varchar(120) NOT NULL DEFAULT 'legacy.operation',
          ADD COLUMN IF NOT EXISTS "requestId" uuid,
          ADD COLUMN IF NOT EXISTS "memberId" uuid,
          ADD COLUMN IF NOT EXISTS "relatedResourceIds" jsonb NOT NULL DEFAULT '{}'::jsonb,
          ADD COLUMN IF NOT EXISTS result varchar(20) NOT NULL DEFAULT 'success',
          ADD COLUMN IF NOT EXISTS "reasonCode" varchar(80),
          ADD COLUMN IF NOT EXISTS "durationMs" integer,
          ADD COLUMN IF NOT EXISTS "departmentIdSnapshot" uuid`, { transaction });
        await sequelize.query(`UPDATE ${quoted}.audit_logs
          SET "eventType" = "resourceType" || '.' || "operationType",
              result = CASE WHEN success THEN 'success' ELSE 'failure' END,
              "departmentIdSnapshot" = "departmentId"
          WHERE "eventType" = 'legacy.operation'
             OR "departmentIdSnapshot" IS NULL`, { transaction });
      }
      if (present.has('question_items')) {
        await sequelize.query(`ALTER TABLE ${quoted}.question_items
          ALTER COLUMN "currentStatusDescription" TYPE text`, { transaction });
      }
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const tables = await sequelize.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = :schemaName
            AND table_name IN ('notifications', 'audit_logs')`,
        { replacements: { schemaName }, type: QueryTypes.SELECT, transaction },
      );
      const present = new Set(tables.map((row) => row.table_name));
      if (present.has('notifications')) {
        const nullNotifications = await sequelize.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM ${quoted}.notifications WHERE "taskId" IS NULL`,
          { type: QueryTypes.SELECT, transaction },
        );
        if (Number(nullNotifications[0]?.count || 0) > 0) {
          throw new Error('存在不关联评估任务的通知，不能回滚关系图加固迁移');
        }
        await sequelize.query(`ALTER TABLE ${quoted}.notifications
          ALTER COLUMN "taskId" SET NOT NULL`, { transaction });
      }
      if (present.has('audit_logs')) {
        await sequelize.query(`ALTER TABLE ${quoted}.audit_logs
          DROP COLUMN IF EXISTS "departmentIdSnapshot",
          DROP COLUMN IF EXISTS "durationMs",
          DROP COLUMN IF EXISTS "reasonCode",
          DROP COLUMN IF EXISTS result,
          DROP COLUMN IF EXISTS "relatedResourceIds",
          DROP COLUMN IF EXISTS "memberId",
          DROP COLUMN IF EXISTS "requestId",
          DROP COLUMN IF EXISTS "eventType"`, { transaction });
      }
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.idempotency_records`, { transaction });
    },
  },
  {
    id: '010_evidence_preview_integrity',
    scope: 'tenant',
    description: 'Preserve evidence versions, integrity scan state and audit-safe deletion metadata',
    checksumSource: 'tenant:v1:evidence-version:scan-status:lock:supersedes:deleted-by:indexes',
    up: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      await sequelize.query(`ALTER TABLE ${quoted}.evidence_files
        ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "scanStatus" varchar(20) NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS "isLocked" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "supersedesId" uuid,
        ADD COLUMN IF NOT EXISTS "deletedBy" uuid`, { transaction });
      await sequelize.query(`WITH ranked AS (
          SELECT id, row_number() OVER (
            PARTITION BY "questionItemId", "evidenceType"
            ORDER BY "uploadedAt", id
          ) AS version_number
          FROM ${quoted}.evidence_files
          WHERE "questionItemId" IS NOT NULL
        )
        UPDATE ${quoted}.evidence_files evidence
           SET version = ranked.version_number
          FROM ranked
         WHERE evidence.id = ranked.id`, { transaction });
      await sequelize.query(`UPDATE ${quoted}.evidence_files
        SET "scanStatus" = 'clean'
        WHERE sha256 IS NOT NULL AND status = 'active' AND "scanStatus" = 'pending'`, { transaction });
      await sequelize.query(`CREATE INDEX IF NOT EXISTS evidence_question_type_version_idx
        ON ${quoted}.evidence_files ("questionItemId", "evidenceType", version)`, { transaction });
      await sequelize.query(`CREATE INDEX IF NOT EXISTS evidence_sha256_idx
        ON ${quoted}.evidence_files (sha256)`, { transaction });
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const protectedRows = await sequelize.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM ${quoted}.evidence_files
        WHERE version > 1 OR "isLocked" = true OR "supersedesId" IS NOT NULL OR "deletedBy" IS NOT NULL
      `, { type: QueryTypes.SELECT, transaction });
      if (Number(protectedRows[0]?.count || 0) > 0) {
        throw new Error('证据版本链或锁定审计信息已被使用，不能安全回滚证据完整性迁移');
      }
      await sequelize.query(`DROP INDEX IF EXISTS ${quoted}.evidence_question_type_version_idx`, { transaction });
      await sequelize.query(`DROP INDEX IF EXISTS ${quoted}.evidence_sha256_idx`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.evidence_files
        DROP COLUMN IF EXISTS "deletedBy",
        DROP COLUMN IF EXISTS "supersedesId",
        DROP COLUMN IF EXISTS "isLocked",
        DROP COLUMN IF EXISTS "scanStatus",
        DROP COLUMN IF EXISTS version`, { transaction });
    },
  },
];

export function migrationChecksum(migration: Migration): string {
  return createHash('sha256')
    .update(`${migration.id}\n${migration.scope}\n${migration.description}\n${migration.checksumSource}`)
    .digest('hex');
}

export default migrations;
