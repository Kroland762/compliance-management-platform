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
  AssessmentAuditor,
  EvaluationAsset,
  EvaluationHistoryLink,
  Finding,
  FindingActionLink,
  RiskFindingLink,
  RiskSource,
  RiskAffectedAsset,
  RemediationAction,
  RiskActionLink,
  AssessmentPlan,
  AssessmentPlanExecution,
  IdempotencyRecord,
  ProductType,
  Product,
  ProductVersion,
  ProductComplianceDossier,
  ProductQuestionnaireTemplate,
  ProductQuestion,
  ProductTypeQuestionnaireRule,
  ProductDossierQuestionnaire,
  ProductDossierAnswer,
  ProductPlatformPermission,
  ProductDataCatalogItem,
  ProductDataItem,
  ProductProcessingActivity,
  ProductPermissionDataItem,
  ProductProcessingDataItem,
  ProductThirdPartyService,
  ProductThirdPartyAssessment,
  ProductThirdPartyAssessmentAnswer,
} from '../../models';
import {
  APP_COMPLIANCE_QUESTIONS,
  BASELINE_COMPLIANCE_QUESTIONS,
  PERSONAL_DATA_CATALOG_ITEMS,
  SYSTEM_SEED_USER_ID,
} from '../product-compliance-template-seed';
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
  transactional?: boolean;
  up: (schemaName: string, transaction?: Transaction) => Promise<void>;
  down?: (schemaName: string, transaction?: Transaction) => Promise<void>;
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
  AssessmentAuditor,
  EvaluationAsset,
  EvaluationHistoryLink,
  Finding,
  RiskRecord,
  RemediationAction,
  FindingActionLink,
  RiskFindingLink,
  RiskSource,
  RiskAffectedAsset,
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
  ProductType,
  Product,
  ProductVersion,
  ProductComplianceDossier,
  ProductQuestionnaireTemplate,
  ProductQuestion,
  ProductTypeQuestionnaireRule,
  ProductDossierQuestionnaire,
  ProductDossierAnswer,
  ProductPlatformPermission,
  ProductDataCatalogItem,
  ProductDataItem,
  ProductProcessingActivity,
  ProductPermissionDataItem,
  ProductProcessingDataItem,
  ProductThirdPartyService,
  ProductThirdPartyAssessment,
  ProductThirdPartyAssessmentAnswer,
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
  {
    id: '011_control_system_role_least_privilege',
    scope: 'control',
    description: 'Remove tenant governance policy access from non-admin system role templates',
    checksumSource: 'control:v1:auditor-minus-organization-settings:member-minus-settings',
    up: async (_schemaName, transaction) => {
      await sequelize.query(`UPDATE public.role_templates
        SET permissions = permissions - 'organization' - 'settings',
            "permissionScopes" = "permissionScopes" - 'organization' - 'settings'
        WHERE "systemKey" = 'auditor'`, { transaction });
      await sequelize.query(`UPDATE public.role_templates
        SET permissions = permissions - 'settings',
            "permissionScopes" = "permissionScopes" - 'settings'
        WHERE "systemKey" = 'member'`, { transaction });
    },
    down: async (_schemaName, transaction) => {
      await sequelize.query(`UPDATE public.role_templates
        SET permissions = permissions || '{"organization":["read"],"settings":["read"]}'::jsonb,
            "permissionScopes" = "permissionScopes" || '{"organization":{"read":"assigned"},"settings":{"read":"assigned"}}'::jsonb
        WHERE "systemKey" = 'auditor'`, { transaction });
      await sequelize.query(`UPDATE public.role_templates
        SET permissions = permissions || '{"settings":["read"]}'::jsonb,
            "permissionScopes" = "permissionScopes" || '{"settings":{"read":"assigned"}}'::jsonb
        WHERE "systemKey" = 'member'`, { transaction });
    },
  },
  {
    id: '011_tenant_system_role_least_privilege',
    scope: 'tenant',
    description: 'Remove tenant governance policy access from existing non-admin system roles',
    checksumSource: 'tenant:v1:auditor-minus-organization-settings:member-minus-settings',
    up: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      await sequelize.query(`UPDATE ${quoted}.roles
        SET permissions = permissions - 'organization' - 'settings',
            "permissionScopes" = "permissionScopes" - 'organization' - 'settings'
        WHERE "systemKey" = 'auditor'`, { transaction });
      await sequelize.query(`UPDATE ${quoted}.roles
        SET permissions = permissions - 'settings',
            "permissionScopes" = "permissionScopes" - 'settings'
        WHERE "systemKey" = 'member'`, { transaction });
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      await sequelize.query(`UPDATE ${quoted}.roles
        SET permissions = permissions || '{"organization":["read"],"settings":["read"]}'::jsonb,
            "permissionScopes" = "permissionScopes" || '{"organization":{"read":"assigned"},"settings":{"read":"assigned"}}'::jsonb
        WHERE "systemKey" = 'auditor'`, { transaction });
      await sequelize.query(`UPDATE ${quoted}.roles
        SET permissions = permissions || '{"settings":["read"]}'::jsonb,
            "permissionScopes" = "permissionScopes" || '{"settings":{"read":"assigned"}}'::jsonb
        WHERE "systemKey" = 'member'`, { transaction });
    },
  },
  {
    id: '012_control_compliance_assessment_workflow',
    scope: 'control',
    description: 'Align built-in role templates with the compliance assessment workflow',
    checksumSource: 'control:v1:assessment-auditor-pool-findings-no-auditor-baseline-ledgers',
    up: async (_schemaName, transaction) => {
      await sequelize.query(`UPDATE public.role_templates
        SET permissions = permissions || '{
          "evaluations":["read","answer","submit","claim","review"],
          "findings":["read","triage","remediate","escalate","verify","close"]
        }'::jsonb,
        "permissionScopes" = "permissionScopes" || '{
          "evaluations":{"read":"all","answer":"all","submit":"all","claim":"all","review":"all"},
          "findings":{"read":"all","triage":"all","remediate":"all","escalate":"all","verify":"all","close":"all"}
        }'::jsonb
        WHERE "systemKey" = 'tenant_admin'`, { transaction });
      await sequelize.query(`UPDATE public.role_templates
        SET permissions = (permissions - 'templates' - 'assets' - 'qualifications' - 'assessment_plans') || '{
          "tasks":["read"],
          "evaluations":["read","claim","review"],
          "findings":["read","triage","remediate","escalate","verify","close"],
          "remediation_actions":["read","verify"]
        }'::jsonb,
        "permissionScopes" = ("permissionScopes" - 'templates' - 'assets' - 'qualifications' - 'assessment_plans') || '{
          "tasks":{"read":"assigned"},
          "evaluations":{"read":"assigned","claim":"assigned","review":"assigned"},
          "findings":{"read":"assigned","triage":"assigned","remediate":"assigned","escalate":"assigned","verify":"assigned","close":"assigned"},
          "remediation_actions":{"read":"assigned","verify":"assigned"}
        }'::jsonb
        WHERE "systemKey" = 'auditor'`, { transaction });
      await sequelize.query(`UPDATE public.role_templates
        SET permissions = (permissions - 'assets') || '{"tasks":["read"],"findings":["read"]}'::jsonb,
            "permissionScopes" = ("permissionScopes" - 'assets') || '{"tasks":{"read":"assigned"},"findings":{"read":"assigned"}}'::jsonb
        WHERE "systemKey" = 'member'`, { transaction });
    },
    down: async (_schemaName, transaction) => {
      await sequelize.query(`UPDATE public.role_templates
        SET permissions = permissions - 'findings',
            "permissionScopes" = "permissionScopes" - 'findings'
        WHERE "systemKey" IN ('tenant_admin','auditor','member')`, { transaction });
    },
  },
  {
    id: '012_tenant_compliance_assessment_workflow',
    scope: 'tenant',
    description: 'Create assessment auditor pools, review claims and finding relationships',
    checksumSource: 'tenant:v2:assessment-auditors-review-claims-findings-actions-risks-workflow-status-role-policy-department-snapshot',
    up: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      await sequelize.query(`CREATE SEQUENCE IF NOT EXISTS ${quoted}.finding_code_seq`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.assessment_assets
        ADD COLUMN IF NOT EXISTS "ownerDepartmentNameSnapshot" varchar(100)`, { transaction });
      await sequelize.query(`CREATE TABLE IF NOT EXISTS ${quoted}.assessment_auditors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "taskId" uuid NOT NULL REFERENCES ${quoted}.audit_tasks(id) ON DELETE CASCADE,
        "auditorUserId" uuid NOT NULL,
        "assignedBy" uuid NOT NULL,
        "assignedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT assessment_auditors_task_user_unique UNIQUE ("taskId", "auditorUserId")
      )`, { transaction });
      await sequelize.query(`CREATE INDEX IF NOT EXISTS assessment_auditors_user_task_idx
        ON ${quoted}.assessment_auditors ("auditorUserId", "taskId")`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.question_items
        ADD COLUMN IF NOT EXISTS "reviewClaimedBy" uuid,
        ADD COLUMN IF NOT EXISTS "reviewClaimedAt" timestamptz`, { transaction });
      await sequelize.query(`CREATE INDEX IF NOT EXISTS question_items_review_claim_idx
        ON ${quoted}.question_items ("reviewClaimedBy", "workflowStatus")`, { transaction });
      await sequelize.query(`CREATE TABLE IF NOT EXISTS ${quoted}.findings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(32) NOT NULL UNIQUE,
        "taskId" uuid NOT NULL REFERENCES ${quoted}.audit_tasks(id) ON DELETE RESTRICT,
        "evaluationId" uuid NOT NULL UNIQUE REFERENCES ${quoted}.question_items(id) ON DELETE RESTRICT,
        title varchar(200) NOT NULL,
        description text NOT NULL,
        severity varchar(20) NOT NULL,
        status varchar(24) NOT NULL DEFAULT 'open',
        disposition varchar(24) NOT NULL DEFAULT 'pending',
        "ownerDepartmentId" uuid NOT NULL,
        "ownerUserId" uuid NOT NULL,
        "dueDate" date,
        "createdBy" uuid NOT NULL,
        "resolvedBy" uuid,
        "resolvedAt" timestamptz,
        "resolutionComment" text,
        "lockVersion" integer NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT findings_severity_check CHECK (severity IN ('critical','high','medium','low')),
        CONSTRAINT findings_status_check CHECK (status IN ('open','remediating','escalated','resolved','cancelled')),
        CONSTRAINT findings_disposition_check CHECK (disposition IN ('pending','direct_remediation','risk'))
      )`, { transaction });
      await sequelize.query(`CREATE INDEX IF NOT EXISTS findings_task_status_idx ON ${quoted}.findings ("taskId", status)`, { transaction });
      await sequelize.query(`CREATE INDEX IF NOT EXISTS findings_owner_status_idx ON ${quoted}.findings ("ownerUserId", status)`, { transaction });
      await sequelize.query(`CREATE TABLE IF NOT EXISTS ${quoted}.finding_action_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "findingId" uuid NOT NULL REFERENCES ${quoted}.findings(id) ON DELETE RESTRICT,
        "actionId" uuid NOT NULL REFERENCES ${quoted}.remediation_actions(id) ON DELETE RESTRICT,
        "isRequired" boolean NOT NULL DEFAULT true,
        "contributionDescription" text NOT NULL,
        "verificationStatus" varchar(20) NOT NULL DEFAULT 'pending',
        "verifiedBy" uuid,
        "verifiedAt" timestamptz,
        "reviewComment" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT finding_action_unique UNIQUE ("findingId", "actionId")
      )`, { transaction });
      await sequelize.query(`CREATE TABLE IF NOT EXISTS ${quoted}.risk_finding_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "riskId" uuid NOT NULL REFERENCES ${quoted}.risk_records(id) ON DELETE RESTRICT,
        "findingId" uuid NOT NULL REFERENCES ${quoted}.findings(id) ON DELETE RESTRICT,
        "relationType" varchar(16) NOT NULL DEFAULT 'primary',
        rationale text,
        "createdBy" uuid NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT risk_finding_unique UNIQUE ("riskId", "findingId")
      )`, { transaction });
      await sequelize.query(`INSERT INTO ${quoted}.assessment_auditors ("taskId", "auditorUserId", "assignedBy")
        SELECT id, "reviewerId", "createdBy" FROM ${quoted}.audit_tasks
        WHERE "reviewerId" IS NOT NULL
        ON CONFLICT ("taskId", "auditorUserId") DO NOTHING`, { transaction });
      await sequelize.query(`UPDATE ${quoted}.audit_tasks SET status = 'review_completed' WHERE status = 'completed'`, { transaction });
      await sequelize.query(`INSERT INTO ${quoted}.findings
          (code, "taskId", "evaluationId", title, description, severity, status, disposition,
           "ownerDepartmentId", "ownerUserId", "createdBy")
        SELECT 'FND-' || to_char(CURRENT_DATE, 'YYYYMM') || '-' || lpad(nextval('${schemaName.replace(/'/g, "''")}.finding_code_seq')::text, 6, '0'),
               item."taskId", item.id, left(item."controlPoint", 200),
               '由历史风险来源迁移生成', 'medium', 'escalated', 'risk',
               item."responsibleDepartmentId", item."assignedTo", source."createdBy"
        FROM ${quoted}.risk_sources source
        JOIN ${quoted}.question_items item ON item.id = source."controlEvaluationId"
        WHERE item."assignedTo" IS NOT NULL
        ON CONFLICT ("evaluationId") DO NOTHING`, { transaction });
      await sequelize.query(`INSERT INTO ${quoted}.risk_finding_links
          ("riskId", "findingId", "relationType", rationale, "createdBy")
        SELECT source."riskId", finding.id, source."relationType", source.rationale, source."createdBy"
        FROM ${quoted}.risk_sources source
        JOIN ${quoted}.findings finding ON finding."evaluationId" = source."controlEvaluationId"
        ON CONFLICT ("riskId", "findingId") DO NOTHING`, { transaction });
      await sequelize.query(`UPDATE ${quoted}.roles
        SET permissions = permissions || '{
          "evaluations":["read","answer","submit","claim","review"],
          "findings":["read","triage","remediate","escalate","verify","close"]
        }'::jsonb,
        "permissionScopes" = "permissionScopes" || '{
          "evaluations":{"read":"all","answer":"all","submit":"all","claim":"all","review":"all"},
          "findings":{"read":"all","triage":"all","remediate":"all","escalate":"all","verify":"all","close":"all"}
        }'::jsonb WHERE "systemKey" = 'tenant_admin'`, { transaction });
      await sequelize.query(`UPDATE ${quoted}.roles
        SET permissions = (permissions - 'templates' - 'assets' - 'qualifications' - 'assessment_plans') || '{
          "tasks":["read"],"evaluations":["read","claim","review"],
          "findings":["read","triage","remediate","escalate","verify","close"],
          "remediation_actions":["read","verify"]
        }'::jsonb,
        "permissionScopes" = ("permissionScopes" - 'templates' - 'assets' - 'qualifications' - 'assessment_plans') || '{
          "tasks":{"read":"assigned"},
          "evaluations":{"read":"assigned","claim":"assigned","review":"assigned"},
          "findings":{"read":"assigned","triage":"assigned","remediate":"assigned","escalate":"assigned","verify":"assigned","close":"assigned"},
          "remediation_actions":{"read":"assigned","verify":"assigned"}
        }'::jsonb WHERE "systemKey" = 'auditor'`, { transaction });
      await sequelize.query(`UPDATE ${quoted}.roles
        SET permissions = (permissions - 'assets') || '{"tasks":["read"],"findings":["read"]}'::jsonb,
            "permissionScopes" = ("permissionScopes" - 'assets') || '{"tasks":{"read":"assigned"},"findings":{"read":"assigned"}}'::jsonb
        WHERE "systemKey" = 'member'`, { transaction });
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const protectedRows = await sequelize.query<{ count: number }>(`
        SELECT (SELECT count(*) FROM ${quoted}.findings)
             + (SELECT count(*) FROM ${quoted}.finding_action_links)
             + (SELECT count(*) FROM ${quoted}.risk_finding_links) AS count
      `, { type: QueryTypes.SELECT, transaction });
      if (Number(protectedRows[0]?.count || 0) > 0) {
        throw new Error('已产生不符合项或其处置关系，不能安全回滚合规评估迁移');
      }
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.risk_finding_links`, { transaction });
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.finding_action_links`, { transaction });
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.findings`, { transaction });
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.assessment_auditors`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.question_items
        DROP COLUMN IF EXISTS "reviewClaimedAt", DROP COLUMN IF EXISTS "reviewClaimedBy"`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.assessment_assets
        DROP COLUMN IF EXISTS "ownerDepartmentNameSnapshot"`, { transaction });
      await sequelize.query(`DROP SEQUENCE IF EXISTS ${quoted}.finding_code_seq`, { transaction });
      await sequelize.query(`UPDATE ${quoted}.audit_tasks SET status = 'completed' WHERE status = 'review_completed'`, { transaction });
    },
  },
  {
    id: '013_control_system_settings',
    scope: 'control',
    description: 'Create the global security settings table used before tenant selection',
    checksumSource: 'control:v1:public-system-settings-login-safe',
    up: async (_schemaName, transaction) => {
      await sequelize.query(`CREATE TABLE IF NOT EXISTS public.system_settings (
        key varchar(100) PRIMARY KEY,
        value text NOT NULL,
        "updatedBy" uuid,
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`, { transaction });
    },
    down: async (_schemaName, transaction) => {
      const rows = await sequelize.query<{ count: number }>(
        'SELECT count(*) AS count FROM public.system_settings',
        { type: QueryTypes.SELECT, transaction },
      );
      if (Number(rows[0]?.count || 0) > 0) {
        throw new Error('全局安全设置已产生数据，不能安全回滚');
      }
      await sequelize.query('DROP TABLE IF EXISTS public.system_settings', { transaction });
    },
  },
  {
    id: '014_tenant_remove_org_governance_asset',
    scope: 'tenant',
    description: 'Remove the legacy ORG-GOVERNANCE placeholder asset when it has no business references',
    checksumSource: 'tenant:v1:remove-unreferenced-org-governance-placeholder',
    up: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const assets = await sequelize.query<{ id: string }>(`
        SELECT id FROM ${quoted}.assets WHERE code = 'ORG-GOVERNANCE'
      `, { type: QueryTypes.SELECT, transaction });
      const assetId = assets[0]?.id;
      if (!assetId) return;

      const references = await sequelize.query<{ count: number }>(`
        SELECT
          (SELECT count(*) FROM ${quoted}.assessment_assets WHERE "assetId" = :assetId)
          + (SELECT count(*) FROM ${quoted}.assessment_control_assets WHERE "assetId" = :assetId)
          + (SELECT count(*) FROM ${quoted}.question_items WHERE "assetId" = :assetId)
          + (SELECT count(*) FROM ${quoted}.risk_affected_assets WHERE "assetId" = :assetId)
          + (SELECT count(*) FROM ${quoted}.assessment_plans
             WHERE "scopeSnapshot"::text LIKE '%' || :assetId || '%'
                OR "matrixSnapshot"::text LIKE '%' || :assetId || '%') AS count
      `, { replacements: { assetId }, type: QueryTypes.SELECT, transaction });
      if (Number(references[0]?.count || 0) > 0) {
        throw new Error('ORG-GOVERNANCE 仍被历史评估、风险或周期计划引用，不能安全删除');
      }
      await sequelize.query(`DELETE FROM ${quoted}.assets WHERE id = :assetId`, {
        replacements: { assetId },
        transaction,
      });
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      await sequelize.query(`INSERT INTO ${quoted}.assets
        (id, code, name, "assetType", criticality, description, metadata, status, "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), 'ORG-GOVERNANCE', '组织级治理', 'organization', 'high',
          '历史系统逻辑资产', '{}'::jsonb, 'active', now(), now())
        ON CONFLICT (code) DO NOTHING`, { transaction });
    },
  },
  {
    id: '015_tenant_assessment_sheet',
    scope: 'tenant',
    description: 'Add configurable assessment columns, multi-asset evaluation rows and historical references',
    checksumSource: 'tenant:v1:template-column-schema:stable-control-key:multi-asset-evaluation:history-links:legacy-backfill',
    up: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const q = (sql: string) => sequelize.query(sql, { transaction });
      await q(`ALTER TABLE ${quoted}.questionnaire_templates
        ADD COLUMN IF NOT EXISTS "standardSeriesKey" varchar(120),
        ADD COLUMN IF NOT EXISTS version varchar(50) NOT NULL DEFAULT '1.0',
        ADD COLUMN IF NOT EXISTS "columnSchema" jsonb NOT NULL DEFAULT '[]'::jsonb`);
      await q(`UPDATE ${quoted}.questionnaire_templates SET "standardSeriesKey" = 'legacy-' || id::text
        WHERE "standardSeriesKey" IS NULL OR btrim("standardSeriesKey") = ''`);
      await q(`ALTER TABLE ${quoted}.questionnaire_templates ALTER COLUMN "standardSeriesKey" SET NOT NULL`);
      await q(`ALTER TABLE ${quoted}.question_templates ADD COLUMN IF NOT EXISTS "controlKey" varchar(120)`);
      await q(`UPDATE ${quoted}.question_templates SET "controlKey" = "sequenceNumber"
        WHERE "controlKey" IS NULL OR btrim("controlKey") = ''`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS question_templates_template_control_key_unique
        ON ${quoted}.question_templates ("templateId", "controlKey")`);
      await q(`UPDATE ${quoted}.questionnaire_templates template SET "columnSchema" = (
        SELECT jsonb_agg(definition ORDER BY position) FROM (
          SELECT 0 AS position, jsonb_build_object('key','sequenceNumber','label','序号','source','core','visible',true,'width',100) AS definition
          UNION ALL SELECT 1, jsonb_build_object('key','controlDomain','label','控制域名','source','core','visible',true,'width',160)
          UNION ALL SELECT 2, jsonb_build_object('key','controlPoint','label','控制点','source','core','visible',true,'width',320)
          UNION ALL SELECT 3, jsonb_build_object('key','referenceAnswer','label','参考回答','source','core','visible',true,'width',240)
          UNION ALL SELECT 100 + row_number() OVER (ORDER BY extra_key),
            jsonb_build_object('key','extraData.' || extra_key,'label',extra_key,'source','extra','visible',true,'width',180)
          FROM (SELECT DISTINCT jsonb_object_keys(COALESCE(question."extraData", '{}'::jsonb)) AS extra_key
            FROM ${quoted}.question_templates question WHERE question."templateId" = template.id) extras
        ) columns
      ) WHERE "columnSchema" = '[]'::jsonb`);
      await q(`ALTER TABLE ${quoted}.audit_tasks
        ADD COLUMN IF NOT EXISTS "columnSchemaSnapshot" jsonb NOT NULL DEFAULT '[]'::jsonb`);
      await q(`UPDATE ${quoted}.audit_tasks task SET "columnSchemaSnapshot" = template."columnSchema"
        FROM ${quoted}.questionnaire_templates template
        WHERE task."templateId" = template.id AND task."columnSchemaSnapshot" = '[]'::jsonb`);
      await q(`ALTER TABLE ${quoted}.question_items
        ADD COLUMN IF NOT EXISTS "controlKey" varchar(120),
        ADD COLUMN IF NOT EXISTS "templateDataSnapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
        ALTER COLUMN "assetId" DROP NOT NULL`);
      await q(`UPDATE ${quoted}.question_items item SET
          "controlKey" = COALESCE(question."controlKey", question."sequenceNumber"),
          "templateDataSnapshot" = jsonb_build_object(
            'sequenceNumber', question."sequenceNumber", 'controlDomain', question."controlDomain",
            'controlPoint', question."controlPoint", 'referenceAnswer', question."referenceAnswer",
            'extraData', COALESCE(question."extraData", '{}'::jsonb))
        FROM ${quoted}.question_templates question WHERE item."templateQuestionId" = question.id
          AND (item."controlKey" IS NULL OR item."templateDataSnapshot" = '{}'::jsonb)`);
      await q(`DROP INDEX IF EXISTS ${quoted}.question_items_task_id_template_question_id_asset_id`);
      await q(`DROP INDEX IF EXISTS ${quoted}.control_evaluation_task_control_asset_unique`);
      await q(`CREATE TABLE IF NOT EXISTS ${quoted}.evaluation_assets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "questionItemId" uuid NOT NULL REFERENCES ${quoted}.question_items(id) ON DELETE CASCADE,
        "taskId" uuid NOT NULL REFERENCES ${quoted}.audit_tasks(id) ON DELETE CASCADE,
        "templateQuestionId" uuid NOT NULL REFERENCES ${quoted}.question_templates(id) ON DELETE RESTRICT,
        "assetId" uuid NOT NULL REFERENCES ${quoted}.assets(id) ON DELETE RESTRICT,
        "createdAt" timestamptz NOT NULL DEFAULT now())`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS evaluation_assets_question_asset_unique
        ON ${quoted}.evaluation_assets ("questionItemId", "assetId")`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS evaluation_assets_task_control_asset_unique
        ON ${quoted}.evaluation_assets ("taskId", "templateQuestionId", "assetId")`);
      await q(`CREATE INDEX IF NOT EXISTS evaluation_assets_asset_idx ON ${quoted}.evaluation_assets ("assetId")`);
      await q(`INSERT INTO ${quoted}.evaluation_assets ("questionItemId", "taskId", "templateQuestionId", "assetId")
        SELECT id, "taskId", "templateQuestionId", "assetId" FROM ${quoted}.question_items WHERE "assetId" IS NOT NULL
        ON CONFLICT ("questionItemId", "assetId") DO NOTHING`);
      await q(`CREATE TABLE IF NOT EXISTS ${quoted}.evaluation_history_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "currentEvaluationId" uuid NOT NULL REFERENCES ${quoted}.question_items(id) ON DELETE CASCADE,
        "sourceEvaluationId" uuid NOT NULL REFERENCES ${quoted}.question_items(id) ON DELETE RESTRICT,
        "matchedAssetIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT evaluation_history_links_not_self CHECK ("currentEvaluationId" <> "sourceEvaluationId"))`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS evaluation_history_links_current_source_unique
        ON ${quoted}.evaluation_history_links ("currentEvaluationId", "sourceEvaluationId")`);
      await q(`CREATE INDEX IF NOT EXISTS evaluation_history_links_source_idx
        ON ${quoted}.evaluation_history_links ("sourceEvaluationId")`);
      await q(`INSERT INTO ${quoted}.evaluation_history_links ("currentEvaluationId", "sourceEvaluationId", "matchedAssetIds")
        SELECT current_item.id, source_item.id, jsonb_agg(DISTINCT current_asset."assetId" ORDER BY current_asset."assetId")
        FROM ${quoted}.question_items current_item
        JOIN ${quoted}.audit_tasks current_task ON current_task.id = current_item."taskId"
        JOIN ${quoted}.questionnaire_templates current_template ON current_template.id = current_task."templateId"
        JOIN ${quoted}.evaluation_assets current_asset ON current_asset."questionItemId" = current_item.id
        JOIN ${quoted}.question_items source_item ON source_item."controlKey" = current_item."controlKey"
          AND source_item.id <> current_item.id AND source_item."workflowStatus" = 'reviewed'
        JOIN ${quoted}.audit_tasks source_task ON source_task.id = source_item."taskId"
        JOIN ${quoted}.questionnaire_templates source_template ON source_template.id = source_task."templateId"
          AND source_template."standardSeriesKey" = current_template."standardSeriesKey"
        JOIN ${quoted}.evaluation_assets source_asset ON source_asset."questionItemId" = source_item.id
          AND source_asset."assetId" = current_asset."assetId"
        WHERE source_task."createdAt" < current_task."createdAt"
        GROUP BY current_item.id, source_item.id
        ON CONFLICT ("currentEvaluationId", "sourceEvaluationId") DO NOTHING`);
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const protectedRows = await sequelize.query<{ count: number }>(`
        SELECT (SELECT count(*) FROM ${quoted}.evaluation_history_links)
          + (SELECT count(*) FROM (SELECT "questionItemId" FROM ${quoted}.evaluation_assets
              GROUP BY "questionItemId" HAVING count(*) <> 1) rows) AS count`,
      { type: QueryTypes.SELECT, transaction });
      if (Number(protectedRows[0]?.count || 0) > 0) {
        throw new Error('已产生历史引用或多资产评估行，不能安全回滚表格式评估迁移');
      }
      await sequelize.query(`UPDATE ${quoted}.question_items item SET "assetId" = link."assetId"
        FROM ${quoted}.evaluation_assets link WHERE link."questionItemId" = item.id`, { transaction });
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.evaluation_history_links`, { transaction });
      await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.evaluation_assets`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.question_items ALTER COLUMN "assetId" SET NOT NULL,
        DROP COLUMN IF EXISTS "controlKey", DROP COLUMN IF EXISTS "templateDataSnapshot"`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.audit_tasks DROP COLUMN IF EXISTS "columnSchemaSnapshot"`, { transaction });
      await sequelize.query(`DROP INDEX IF EXISTS ${quoted}.question_templates_template_control_key_unique`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.question_templates DROP COLUMN IF EXISTS "controlKey"`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.questionnaire_templates DROP COLUMN IF EXISTS "standardSeriesKey",
        DROP COLUMN IF EXISTS version, DROP COLUMN IF EXISTS "columnSchema"`, { transaction });
    },
  },
  {
    id: '016_control_auth_sessions',
    scope: 'control',
    description: 'Create revocable rotating authentication sessions',
    checksumSource: 'control:v1:auth-sessions-refresh-hash-expiry-revocation-indexes-guarded-rollback',
    up: async (_schemaName, transaction) => {
      await sequelize.query(`CREATE TABLE IF NOT EXISTS public.auth_sessions (
        id uuid PRIMARY KEY,
        "userId" uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        "refreshTokenHash" char(64) NOT NULL UNIQUE,
        "expiresAt" timestamptz NOT NULL,
        "revokedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`, { transaction });
      await sequelize.query(`CREATE INDEX IF NOT EXISTS auth_sessions_user_active_idx
        ON public.auth_sessions ("userId", "expiresAt") WHERE "revokedAt" IS NULL`, { transaction });
      await sequelize.query(`CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx
        ON public.auth_sessions ("expiresAt")`, { transaction });
    },
    down: async (_schemaName, transaction) => {
      const active = await sequelize.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM public.auth_sessions
        WHERE "revokedAt" IS NULL AND "expiresAt" > now()
      `, { type: QueryTypes.SELECT, transaction });
      if (Number(active[0]?.count || 0) > 0) {
        throw new Error('存在未过期的登录会话，不能安全回滚认证会话迁移');
      }
      await sequelize.query('DROP TABLE IF EXISTS public.auth_sessions', { transaction });
    },
  },
  {
    id: '017_tenant_assessment_statuses',
    scope: 'tenant',
    description: 'Collapse legacy assessment project statuses into the canonical lifecycle',
    checksumSource: 'tenant:v1:assessment-statuses:preparing-ready-in-progress-pending-review-pending-closure-closed-cancelled-check',
    up: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      await sequelize.query(`ALTER TABLE ${quoted}.audit_tasks
        DROP CONSTRAINT IF EXISTS audit_tasks_status_check`, { transaction });
      await sequelize.query(`UPDATE ${quoted}.audit_tasks SET status = CASE
        WHEN status IN ('draft', 'configuring') THEN 'preparing'
        WHEN status IN ('published', 'assigned') THEN 'ready'
        WHEN status IN ('in_progress', 'returned') THEN 'in_progress'
        WHEN status IN ('submitted', 'under_review') THEN 'pending_review'
        WHEN status IN ('completed', 'review_completed') THEN 'pending_closure'
        WHEN status IN ('closed', 'cancelled') THEN status
        ELSE status END`, { transaction });
      const unsupported = await sequelize.query<{ status: string; count: number }>(`
        SELECT status, count(*)::int AS count FROM ${quoted}.audit_tasks
        WHERE status NOT IN ('preparing','ready','in_progress','pending_review','pending_closure','closed','cancelled')
        GROUP BY status
      `, { type: QueryTypes.SELECT, transaction });
      if (unsupported.length > 0) {
        throw new Error(`存在无法迁移的评估状态: ${unsupported.map((row) => `${row.status}(${row.count})`).join(', ')}`);
      }
      await sequelize.query(`ALTER TABLE ${quoted}.audit_tasks
        ALTER COLUMN status SET DEFAULT 'preparing',
        ADD CONSTRAINT audit_tasks_status_check CHECK
          (status IN ('preparing','ready','in_progress','pending_review','pending_closure','closed','cancelled'))`,
      { transaction });
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      await sequelize.query(`ALTER TABLE ${quoted}.audit_tasks
        DROP CONSTRAINT IF EXISTS audit_tasks_status_check`, { transaction });
      await sequelize.query(`UPDATE ${quoted}.audit_tasks SET status = CASE
        WHEN status = 'preparing' THEN 'draft'
        WHEN status = 'ready' THEN 'published'
        WHEN status = 'in_progress' THEN 'in_progress'
        WHEN status = 'pending_review' THEN 'under_review'
        WHEN status = 'pending_closure' THEN 'review_completed'
        WHEN status IN ('closed', 'cancelled') THEN status
        ELSE status END`, { transaction });
      await sequelize.query(`ALTER TABLE ${quoted}.audit_tasks
        ALTER COLUMN status SET DEFAULT 'draft'`, { transaction });
    },
  },
  {
    id: '018_tenant_evaluation_filters',
    scope: 'tenant',
    description: 'Add assessment sheet filter indexes and rebuild historical references',
    checksumSource: 'tenant:v1:evaluation-filters:task-sequence-status:task-asset:template-snapshot-gin:history-link-rebuild',
    up: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const q = (sql: string) => sequelize.query(sql, { transaction });
      await q(`CREATE INDEX IF NOT EXISTS question_items_task_sequence_idx
        ON ${quoted}.question_items ("taskId", "sequenceNumber", id)`);
      await q(`CREATE INDEX IF NOT EXISTS question_items_task_status_idx
        ON ${quoted}.question_items ("taskId", "workflowStatus", "complianceStatus")`);
      await q(`CREATE INDEX IF NOT EXISTS evaluation_assets_task_asset_idx
        ON ${quoted}.evaluation_assets ("taskId", "assetId", "questionItemId")`);
      await q(`CREATE INDEX IF NOT EXISTS question_items_template_snapshot_gin
        ON ${quoted}.question_items USING gin ("templateDataSnapshot" jsonb_path_ops)`);
      await q(`DELETE FROM ${quoted}.evaluation_history_links`);
      await q(`INSERT INTO ${quoted}.evaluation_history_links
          ("currentEvaluationId", "sourceEvaluationId", "matchedAssetIds")
        SELECT current_item.id, source_item.id,
          jsonb_agg(DISTINCT current_asset."assetId" ORDER BY current_asset."assetId")
        FROM ${quoted}.question_items current_item
        JOIN ${quoted}.audit_tasks current_task ON current_task.id = current_item."taskId"
        JOIN ${quoted}.questionnaire_templates current_template ON current_template.id = current_task."templateId"
        JOIN ${quoted}.evaluation_assets current_asset ON current_asset."questionItemId" = current_item.id
        JOIN ${quoted}.question_items source_item ON source_item."controlKey" = current_item."controlKey"
          AND source_item.id <> current_item.id AND source_item."workflowStatus" = 'reviewed'
        JOIN ${quoted}.audit_tasks source_task ON source_task.id = source_item."taskId"
        JOIN ${quoted}.questionnaire_templates source_template ON source_template.id = source_task."templateId"
          AND source_template."standardSeriesKey" = current_template."standardSeriesKey"
        JOIN ${quoted}.evaluation_assets source_asset ON source_asset."questionItemId" = source_item.id
          AND source_asset."assetId" = current_asset."assetId"
        WHERE source_task."createdAt" < current_task."createdAt"
        GROUP BY current_item.id, source_item.id`);
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      await sequelize.query(`DROP INDEX IF EXISTS ${quoted}.question_items_template_snapshot_gin`, { transaction });
      await sequelize.query(`DROP INDEX IF EXISTS ${quoted}.evaluation_assets_task_asset_idx`, { transaction });
      await sequelize.query(`DROP INDEX IF EXISTS ${quoted}.question_items_task_status_idx`, { transaction });
      await sequelize.query(`DROP INDEX IF EXISTS ${quoted}.question_items_task_sequence_idx`, { transaction });
    },
  },
  {
    id: '019_control_product_compliance_permissions',
    scope: 'control',
    description: 'Add product compliance permissions to locked system role templates',
    checksumSource: 'control:v1:product-compliance-role-template-permissions-scopes',
    up: async (_schemaName, transaction) => {
      const permissionPatch: Record<string, Record<string, string[]>> = {
        tenant_admin: {
          products: ['create', 'read', 'update', 'archive'],
          product_dossiers: ['read', 'update', 'submit', 'review', 'confirm', 'revise'],
          product_compliance_config: ['create', 'read', 'update', 'retire'],
        },
        auditor: {
          products: ['read'],
          product_dossiers: ['read', 'review', 'confirm'],
          product_compliance_config: ['read'],
        },
        member: {
          products: ['read'],
          product_dossiers: ['read', 'update', 'submit'],
        },
      };
      for (const [systemKey, resources] of Object.entries(permissionPatch)) {
        const template = await RoleTemplate.findOne({ where: { systemKey }, transaction });
        if (!template) continue;
        const permissions = { ...(template.permissions as Record<string, string[]>) };
        const permissionScopes = { ...(template.permissionScopes as Record<string, Record<string, string>>) };
        for (const [resource, actions] of Object.entries(resources)) {
          permissions[resource] = actions;
          permissionScopes[resource] = Object.fromEntries(actions.map((action) => [
            action,
            systemKey === 'member' ? 'assigned' : 'all',
          ]));
        }
        await template.update({ permissions, permissionScopes }, { transaction });
      }
    },
    down: async (_schemaName, transaction) => {
      for (const systemKey of ['tenant_admin', 'auditor', 'member']) {
        const template = await RoleTemplate.findOne({ where: { systemKey }, transaction });
        if (!template) continue;
        const permissions = { ...(template.permissions as Record<string, string[]>) };
        const permissionScopes = { ...(template.permissionScopes as Record<string, Record<string, string>>) };
        for (const resource of ['products', 'product_dossiers', 'product_compliance_config']) {
          delete permissions[resource];
          delete permissionScopes[resource];
        }
        await template.update({ permissions, permissionScopes }, { transaction });
      }
    },
  },
  {
    id: '019_tenant_product_compliance',
    scope: 'tenant',
    description: 'Create versioned product compliance dossiers, questionnaire snapshots and ROPA records',
    checksumSource: 'tenant:v1:product-version-dossier-revision-questionnaire-data-permission-ropa-role-permissions',
    up: async (schemaName, transaction) => {
      await runWithTenantContext({ schema: schemaName, tenantId: null }, async () => {
        for (const model of [
          ProductType, Product, ProductVersion, ProductComplianceDossier,
          ProductQuestionnaireTemplate, ProductQuestion, ProductTypeQuestionnaireRule,
          ProductDossierQuestionnaire, ProductDossierAnswer, ProductPlatformPermission,
          ProductDataItem, ProductProcessingActivity, ProductPermissionDataItem,
          ProductProcessingDataItem,
        ]) await (model as any).schema(schemaName).sync({ transaction } as any);
      });
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS product_dossiers_current_confirmed_unique
        ON ${quoted}.product_compliance_dossiers ("productVersionId")
        WHERE "isCurrentConfirmed" = true`, { transaction });
      await sequelize.query(`UPDATE ${quoted}.roles SET permissions = permissions || CASE "systemKey"
          WHEN 'tenant_admin' THEN '{"products":["create","read","update","archive"],"product_dossiers":["read","update","submit","review","confirm","revise"],"product_compliance_config":["create","read","update","retire"]}'::jsonb
          WHEN 'auditor' THEN '{"products":["read"],"product_dossiers":["read","review","confirm"],"product_compliance_config":["read"]}'::jsonb
          WHEN 'member' THEN '{"products":["read"],"product_dossiers":["read","update","submit"]}'::jsonb ELSE '{}'::jsonb END,
        "permissionScopes" = "permissionScopes" || CASE "systemKey"
          WHEN 'tenant_admin' THEN '{"products":{"create":"all","read":"all","update":"all","archive":"all"},"product_dossiers":{"read":"all","update":"all","submit":"all","review":"all","confirm":"all","revise":"all"},"product_compliance_config":{"create":"all","read":"all","update":"all","retire":"all"}}'::jsonb
          WHEN 'auditor' THEN '{"products":{"read":"all"},"product_dossiers":{"read":"all","review":"all","confirm":"all"},"product_compliance_config":{"read":"all"}}'::jsonb
          WHEN 'member' THEN '{"products":{"read":"assigned"},"product_dossiers":{"read":"assigned","update":"assigned","submit":"assigned"}}'::jsonb ELSE '{}'::jsonb END
        WHERE "isSystem" = true AND "systemKey" IN ('tenant_admin','auditor','member')`, { transaction });
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const [existing] = await sequelize.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM ${quoted}.products`,
        { type: QueryTypes.SELECT, transaction },
      );
      if (Number(existing?.count || 0) > 0) throw new Error('已存在产品合规业务数据，不能安全回滚产品合规模块');
      for (const table of [
        'product_processing_data_items', 'product_permission_data_items', 'product_processing_activities',
        'product_data_items', 'product_platform_permissions', 'product_dossier_answers',
        'product_dossier_questionnaires', 'product_type_questionnaire_rules', 'product_questions',
        'product_questionnaire_templates', 'product_compliance_dossiers', 'product_versions', 'products',
        'product_types',
      ]) await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.${table}`, { transaction });
      await sequelize.query(`UPDATE ${quoted}.roles SET
        permissions = permissions - 'products' - 'product_dossiers' - 'product_compliance_config',
        "permissionScopes" = "permissionScopes" - 'products' - 'product_dossiers' - 'product_compliance_config'
        WHERE "isSystem" = true`, { transaction });
    },
  },
  {
    id: '020_tenant_product_compliance_constraints',
    scope: 'tenant',
    description: 'Enforce product compliance workflow and configuration status domains',
    checksumSource: 'tenant:v1:product-compliance-status-question-type-source-checks',
    up: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const q = (sql: string) => sequelize.query(sql, { transaction });
      await q(`ALTER TABLE ${quoted}.product_types ADD CONSTRAINT product_types_status_check CHECK (status IN ('active','retired'))`);
      await q(`ALTER TABLE ${quoted}.products ADD CONSTRAINT products_status_check CHECK (status IN ('active','archived'))`);
      await q(`ALTER TABLE ${quoted}.product_compliance_dossiers
        ADD CONSTRAINT product_dossiers_lifecycle_check CHECK ("lifecycleStatus" IN ('draft','pending_review','changes_requested','confirmed','superseded')),
        ADD CONSTRAINT product_dossiers_conclusion_check CHECK ("complianceConclusion" IN ('not_assessed','compliant','conditionally_compliant','non_compliant')),
        ADD CONSTRAINT product_dossiers_proposed_conclusion_check CHECK ("proposedConclusion" IS NULL OR "proposedConclusion" IN ('not_assessed','compliant','conditionally_compliant','non_compliant'))`);
      await q(`ALTER TABLE ${quoted}.product_questionnaire_templates ADD CONSTRAINT product_questionnaire_status_check CHECK (status IN ('draft','active','retired'))`);
      await q(`ALTER TABLE ${quoted}.product_questions ADD CONSTRAINT product_question_type_check CHECK ("questionType" IN ('boolean','single_select','multi_select','short_text','long_text','number','date'))`);
      await q(`ALTER TABLE ${quoted}.product_dossier_questionnaires ADD CONSTRAINT product_questionnaire_source_check CHECK ("assignmentSource" IN ('rule','manual'))`);
      await q(`ALTER TABLE ${quoted}.product_dossier_answers ADD CONSTRAINT product_answer_inheritance_check CHECK ("inheritanceStatus" IN ('new','inherited','modified','unanswered'))`);
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      for (const [table, constraint] of [
        ['product_dossier_answers', 'product_answer_inheritance_check'],
        ['product_dossier_questionnaires', 'product_questionnaire_source_check'],
        ['product_questions', 'product_question_type_check'],
        ['product_questionnaire_templates', 'product_questionnaire_status_check'],
        ['product_compliance_dossiers', 'product_dossiers_proposed_conclusion_check'],
        ['product_compliance_dossiers', 'product_dossiers_conclusion_check'],
        ['product_compliance_dossiers', 'product_dossiers_lifecycle_check'],
        ['products', 'products_status_check'],
        ['product_types', 'product_types_status_check'],
      ]) await sequelize.query(`ALTER TABLE ${quoted}.${table} DROP CONSTRAINT IF EXISTS ${constraint}`, { transaction });
    },
  },
  {
    id: '021_tenant_account_problem_history',
    scope: 'tenant',
    description: 'Add account problem status history and enforce account audit status domains',
    checksumSource: 'tenant:v1:account-problem-history-status-severity-task-schedule-execution-phase-constraints',
    up: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const domains: Array<[string, string, string[]]> = [
        ['account_problems', 'status', ['PENDING', 'PROCESSING', 'RESOLVED', 'AUTO_RESOLVED', 'FALSE_POSITIVE', 'IGNORED']],
        ['account_problems', 'severity', ['LOW', 'MEDIUM', 'HIGH']],
        ['account_audit_rules', 'severity', ['LOW', 'MEDIUM', 'HIGH']],
        ['account_audit_tasks', 'status', ['ACTIVE', 'INACTIVE']],
        ['account_audit_tasks', 'scheduleType', ['MANUAL', 'DAILY', 'WEEKLY', 'MONTHLY', 'CRON']],
        ['account_task_executions', 'status', ['RUNNING', 'SUCCESS', 'FAILED']],
      ];
      for (const [table, column, values] of domains) {
        const unsupported = await sequelize.query<{ value: string; count: number }>(
          `SELECT "${column}" AS value, count(*)::int AS count FROM ${quoted}.${table}
           WHERE "${column}" IS NOT NULL AND "${column}" NOT IN (${values.map((value) => `'${value}'`).join(',')})
           GROUP BY "${column}"`,
          { type: QueryTypes.SELECT, transaction },
        );
        if (unsupported.length) {
          throw new Error(`${table}.${column} 存在非法值: ${unsupported.map((row) => `${row.value}(${row.count})`).join(', ')}`);
        }
      }
      const invalidPhases = await sequelize.query<{ value: string; count: number }>(
        `SELECT "currentPhase" AS value, count(*)::int AS count FROM ${quoted}.account_task_executions
         WHERE "currentPhase" IS NOT NULL AND "currentPhase" NOT IN ('SYNCING','MAPPING','MATCHING','SAVING')
         GROUP BY "currentPhase"`,
        { type: QueryTypes.SELECT, transaction },
      );
      if (invalidPhases.length) throw new Error(`account_task_executions.currentPhase 存在非法值: ${invalidPhases.map((row) => `${row.value}(${row.count})`).join(', ')}`);

      await sequelize.query(`CREATE TABLE ${quoted}.account_problem_status_history (
        id uuid PRIMARY KEY,
        "problemId" uuid NOT NULL REFERENCES ${quoted}.account_problems(id) ON DELETE CASCADE,
        "fromStatus" varchar(20),
        "toStatus" varchar(20) NOT NULL,
        "changedBy" uuid,
        source varchar(20) NOT NULL,
        notes text,
        "changedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT account_problem_history_from_status_check CHECK ("fromStatus" IS NULL OR "fromStatus" IN ('PENDING','PROCESSING','RESOLVED','AUTO_RESOLVED','FALSE_POSITIVE','IGNORED')),
        CONSTRAINT account_problem_history_to_status_check CHECK ("toStatus" IN ('PENDING','PROCESSING','RESOLVED','AUTO_RESOLVED','FALSE_POSITIVE','IGNORED')),
        CONSTRAINT account_problem_history_source_check CHECK (source IN ('MANUAL','BULK','AUTO','MIGRATION'))
      )`, { transaction });
      await sequelize.query(`CREATE INDEX account_problem_history_problem_changed_idx
        ON ${quoted}.account_problem_status_history ("problemId", "changedAt" DESC)`, { transaction });
      await sequelize.query(`INSERT INTO ${quoted}.account_problem_status_history
        (id, "problemId", "fromStatus", "toStatus", "changedBy", source, notes, "changedAt")
        SELECT gen_random_uuid(), id, NULL, status, NULL, 'MIGRATION', '迁移时的当前状态快照', "updatedAt"
        FROM ${quoted}.account_problems`, { transaction });

      for (const [table, column, values] of domains) {
        await sequelize.query(`ALTER TABLE ${quoted}.${table}
          ADD CONSTRAINT ${table}_${column.toLowerCase()}_domain_check
          CHECK ("${column}" IS NULL OR "${column}" IN (${values.map((value) => `'${value}'`).join(',')}))`, { transaction });
      }
      await sequelize.query(`ALTER TABLE ${quoted}.account_task_executions
        ADD CONSTRAINT account_task_executions_phase_domain_check
        CHECK ("currentPhase" IS NULL OR "currentPhase" IN ('SYNCING','MAPPING','MATCHING','SAVING'))`, { transaction });
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const [{ count }] = await sequelize.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM ${quoted}.account_problem_status_history WHERE source <> 'MIGRATION'`,
        { type: QueryTypes.SELECT, transaction },
      );
      if (Number(count) > 0) throw new Error('已存在迁移后的问题状态历史，不能安全回滚');
      for (const constraint of [
        ['account_task_executions', 'account_task_executions_phase_domain_check'],
        ['account_task_executions', 'account_task_executions_status_domain_check'],
        ['account_audit_tasks', 'account_audit_tasks_scheduletype_domain_check'],
        ['account_audit_tasks', 'account_audit_tasks_status_domain_check'],
        ['account_audit_rules', 'account_audit_rules_severity_domain_check'],
        ['account_problems', 'account_problems_severity_domain_check'],
        ['account_problems', 'account_problems_status_domain_check'],
      ]) await sequelize.query(`ALTER TABLE ${quoted}.${constraint[0]} DROP CONSTRAINT IF EXISTS ${constraint[1]}`, { transaction });
      await sequelize.query(`DROP TABLE ${quoted}.account_problem_status_history`, { transaction });
    },
  },
  {
    id: '022_control_pg_trgm',
    scope: 'control',
    description: 'Enable PostgreSQL trigram search support for human-readable lookups',
    checksumSource: 'control:v1:pg-trgm-extension',
    up: async (_schemaName, transaction) => {
      await sequelize.query('CREATE EXTENSION IF NOT EXISTS pg_trgm', { transaction });
    },
    // pg_trgm is database-wide and may be shared by other schemas. Rollback only
    // removes indexes created by the following migrations, never the extension.
    down: async () => undefined,
  },
  {
    id: '023_control_lookup_trgm_indexes',
    scope: 'control',
    description: 'Create concurrent trigram index for username lookup',
    checksumSource: 'control:v1:users-username-trgm-concurrent',
    transactional: false,
    up: async () => {
      const [invalid] = await sequelize.query<{ invalid: boolean }>(`
        SELECT NOT i.indisvalid AS invalid
        FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'users_username_trgm_idx'
      `, { type: QueryTypes.SELECT });
      if (invalid?.invalid) await sequelize.query('DROP INDEX CONCURRENTLY IF EXISTS public.users_username_trgm_idx');
      await sequelize.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS users_username_trgm_idx ON public.users USING gin (username gin_trgm_ops)');
    },
    down: async () => {
      await sequelize.query('DROP INDEX CONCURRENTLY IF EXISTS public.users_username_trgm_idx');
    },
  },
  {
    id: '024_tenant_lookup_trgm_indexes',
    scope: 'tenant',
    description: 'Create concurrent trigram indexes for tenant lookup labels',
    checksumSource: 'tenant:v1:lookup-name-title-trgm-concurrent',
    transactional: false,
    up: async (schemaName) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const definitions: Array<[string, string, string]> = [
        ['departments_name_trgm_idx', 'departments', 'name'],
        ['tenant_members_display_name_trgm_idx', 'tenant_members', 'displayName'],
        ['roles_name_trgm_idx', 'roles', 'name'],
        ['assets_name_trgm_idx', 'assets', 'name'],
        ['risk_records_title_trgm_idx', 'risk_records', 'title'],
        ['questionnaire_templates_name_trgm_idx', 'questionnaire_templates', 'name'],
        ['account_data_sources_name_trgm_idx', 'account_data_sources', 'name'],
        ['account_audit_rules_name_trgm_idx', 'account_audit_rules', 'name'],
        ['product_types_name_trgm_idx', 'product_types', 'name'],
        ['product_questionnaire_templates_name_trgm_idx', 'product_questionnaire_templates', 'name'],
      ];
      for (const [index, table, column] of definitions) {
        const [invalid] = await sequelize.query<{ invalid: boolean }>(`
          SELECT NOT i.indisvalid AS invalid
          FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = :schemaName AND c.relname = :index
        `, { replacements: { schemaName, index }, type: QueryTypes.SELECT });
        if (invalid?.invalid) await sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS ${quoted}."${index}"`);
        await sequelize.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${index}" ON ${quoted}."${table}" USING gin ("${column}" gin_trgm_ops)`);
      }
    },
    down: async (schemaName) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      for (const index of [
        'departments_name_trgm_idx', 'tenant_members_display_name_trgm_idx', 'roles_name_trgm_idx',
        'assets_name_trgm_idx', 'risk_records_title_trgm_idx', 'questionnaire_templates_name_trgm_idx',
        'account_data_sources_name_trgm_idx', 'account_audit_rules_name_trgm_idx', 'product_types_name_trgm_idx',
        'product_questionnaire_templates_name_trgm_idx',
      ]) await sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS ${quoted}."${index}"`);
    },
  },
  {
    id: '025_tenant_product_compliance_app_sdk_templates',
    scope: 'tenant',
    description: 'Embed APP and SDK compliance dossier templates as system-managed data',
    checksumSource: 'tenant:v1:product-compliance-app-sdk-template-catalog-third-party-export-fields',
    up: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const q = (sql: string, replacements?: Record<string, unknown>) =>
        sequelize.query(sql, { transaction, replacements });

      await runWithTenantContext({ schema: schemaName, tenantId: null }, async () => {
        for (const model of [
          ProductDataCatalogItem,
          ProductThirdPartyService,
          ProductThirdPartyAssessment,
          ProductThirdPartyAssessmentAnswer,
        ]) await (model as any).schema(schemaName).sync({ transaction } as any);
      });

      await q(`ALTER TABLE ${quoted}.product_platform_permissions
        ADD COLUMN IF NOT EXISTS "operatingSystem" varchar(80)`);
      await q(`ALTER TABLE ${quoted}.product_data_items
        ADD COLUMN IF NOT EXISTS "catalogItemId" uuid,
        ADD COLUMN IF NOT EXISTS purpose text,
        ADD COLUMN IF NOT EXISTS necessity varchar(40),
        ADD COLUMN IF NOT EXISTS "processingMethod" varchar(160),
        ADD COLUMN IF NOT EXISTS "operatingSystems" jsonb NOT NULL DEFAULT '[]'::jsonb`);
      await q(`DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_schema = '${schemaName.replace(/'/g, "''")}'
              AND table_name = 'product_data_items'
              AND constraint_name = 'product_data_items_catalog_fk'
          ) THEN
            ALTER TABLE ${quoted}.product_data_items
              ADD CONSTRAINT product_data_items_catalog_fk
              FOREIGN KEY ("catalogItemId") REFERENCES ${quoted}.product_data_catalog_items(id)
              ON DELETE RESTRICT;
          END IF;
        END $$`);
      await q(`ALTER TABLE ${quoted}.product_processing_activities
        ADD COLUMN IF NOT EXISTS "dataSource" text,
        ADD COLUMN IF NOT EXISTS "writesToLog" boolean,
        ADD COLUMN IF NOT EXISTS "dataScale" text,
        ADD COLUMN IF NOT EXISTS "transferPath" text,
        ADD COLUMN IF NOT EXISTS "transferEncryption" text,
        ADD COLUMN IF NOT EXISTS "thirdPartyProcessor" text,
        ADD COLUMN IF NOT EXISTS "thirdPartyProcessingAgreement" boolean,
        ADD COLUMN IF NOT EXISTS stored boolean,
        ADD COLUMN IF NOT EXISTS "storageSystem" text,
        ADD COLUMN IF NOT EXISTS "storageLocation" text,
        ADD COLUMN IF NOT EXISTS "storageEncryption" text,
        ADD COLUMN IF NOT EXISTS "accessControl" text,
        ADD COLUMN IF NOT EXISTS anonymization text,
        ADD COLUMN IF NOT EXISTS "systemLogging" text,
        ADD COLUMN IF NOT EXISTS "bulkExportAllowed" boolean,
        ADD COLUMN IF NOT EXISTS "deletionMechanism" text,
        ADD COLUMN IF NOT EXISTS "retentionBasis" text`);

      for (const type of [
        { code: 'APP', name: 'APP', description: '移动应用产品合规档案' },
        { code: 'SDK', name: 'SDK', description: 'SDK 产品合规档案' },
      ]) {
        await q(`INSERT INTO ${quoted}.product_types
          (id, code, name, description, status, "createdBy", "createdAt", "updatedAt")
          VALUES (gen_random_uuid(), :code, :name, :description, 'active', :createdBy, now(), now())
          ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
          status = 'active', "updatedAt" = now()`, { ...type, createdBy: SYSTEM_SEED_USER_ID });
      }

      const upsertTemplate = async (input: { seriesKey: string; name: string; description: string; version: string }, questions: typeof BASELINE_COMPLIANCE_QUESTIONS) => {
        await q(`INSERT INTO ${quoted}.product_questionnaire_templates
          (id, "seriesKey", name, description, version, status, "createdBy", "publishedAt", "createdAt", "updatedAt")
          VALUES (gen_random_uuid(), :seriesKey, :name, :description, :version, 'active', :createdBy, now(), now(), now())
          ON CONFLICT ("seriesKey", version) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
          status = 'active', "publishedAt" = COALESCE(${quoted}.product_questionnaire_templates."publishedAt", now()), "updatedAt" = now()`,
        { ...input, createdBy: SYSTEM_SEED_USER_ID });
        const [template] = await sequelize.query<{ id: string }>(
          `SELECT id FROM ${quoted}.product_questionnaire_templates WHERE "seriesKey" = :seriesKey AND version = :version`,
          { replacements: { seriesKey: input.seriesKey, version: input.version }, type: QueryTypes.SELECT, transaction },
        );
        if (!template) throw new Error(`无法创建产品合规问卷模板 ${input.seriesKey}`);
        for (const [index, question] of questions.entries()) {
          await q(`INSERT INTO ${quoted}.product_questions
            (id, "templateId", "stableKey", title, description, "questionType", required, options, "sortOrder")
            VALUES (gen_random_uuid(), :templateId, :stableKey, :title, :description, :questionType, :required, CAST(:options AS jsonb), :sortOrder)
            ON CONFLICT ("templateId", "stableKey") DO UPDATE SET title = EXCLUDED.title,
            description = EXCLUDED.description, "questionType" = EXCLUDED."questionType",
            required = EXCLUDED.required, options = EXCLUDED.options, "sortOrder" = EXCLUDED."sortOrder"`,
          {
            templateId: template.id,
            stableKey: question.stableKey,
            title: question.title,
            description: question.description,
            questionType: question.questionType,
            required: question.required,
            options: JSON.stringify(question.options),
            sortOrder: index,
          });
        }
      };
      await upsertTemplate({
        seriesKey: 'app-sdk-compliance-baseline',
        name: 'APP/SDK 合规问卷 - 基础问题',
        description: '由 APP/SDK 合规档案模板内置的公共基础问题',
        version: '1.0',
      }, BASELINE_COMPLIANCE_QUESTIONS);
      await upsertTemplate({
        seriesKey: 'app-compliance-checklist',
        name: 'APP 合规问卷',
        description: '由 APP 合规档案模板内置的移动应用专项问题',
        version: '1.0',
      }, APP_COMPLIANCE_QUESTIONS);

      const [baselineTemplate] = await sequelize.query<{ id: string }>(
        `SELECT id FROM ${quoted}.product_questionnaire_templates WHERE "seriesKey" = 'app-sdk-compliance-baseline' AND version = '1.0'`,
        { type: QueryTypes.SELECT, transaction },
      );
      const [appTemplate] = await sequelize.query<{ id: string }>(
        `SELECT id FROM ${quoted}.product_questionnaire_templates WHERE "seriesKey" = 'app-compliance-checklist' AND version = '1.0'`,
        { type: QueryTypes.SELECT, transaction },
      );
      const [appType] = await sequelize.query<{ id: string }>(
        `SELECT id FROM ${quoted}.product_types WHERE code = 'APP'`,
        { type: QueryTypes.SELECT, transaction },
      );
      const [sdkType] = await sequelize.query<{ id: string }>(
        `SELECT id FROM ${quoted}.product_types WHERE code = 'SDK'`,
        { type: QueryTypes.SELECT, transaction },
      );
      for (const [productTypeId, templateId] of [
        [appType?.id, baselineTemplate?.id],
        [appType?.id, appTemplate?.id],
        [sdkType?.id, baselineTemplate?.id],
      ]) {
        if (!productTypeId || !templateId) throw new Error('APP/SDK 产品合规模板规则初始化失败');
        await q(`INSERT INTO ${quoted}.product_type_questionnaire_rules
          (id, "productTypeId", "templateId", required, active, "createdBy", "createdAt")
          VALUES (gen_random_uuid(), :productTypeId, :templateId, true, true, :createdBy, now())
          ON CONFLICT ("productTypeId", "templateId") DO UPDATE SET required = true, active = true`,
        { productTypeId, templateId, createdBy: SYSTEM_SEED_USER_ID });
      }

      for (const [index, item] of PERSONAL_DATA_CATALOG_ITEMS.entries()) {
        await q(`INSERT INTO ${quoted}.product_data_catalog_items
          (id, "stableKey", "dataSubject", category, name, sensitive, required, status, "sortOrder", "createdBy", "createdAt", "updatedAt")
          VALUES (gen_random_uuid(), :stableKey, :dataSubject, :category, :name, :sensitive, :required, 'active', :sortOrder, :createdBy, now(), now())
          ON CONFLICT ("stableKey") DO UPDATE SET "dataSubject" = EXCLUDED."dataSubject",
          category = EXCLUDED.category, name = EXCLUDED.name, sensitive = EXCLUDED.sensitive,
          required = EXCLUDED.required, status = 'active', "sortOrder" = EXCLUDED."sortOrder", "updatedAt" = now()`,
        { ...item, sortOrder: index, createdBy: SYSTEM_SEED_USER_ID });
      }
    },
    down: async (schemaName, transaction) => {
      const quoted = `"${schemaName.replace(/"/g, '""')}"`;
      const [{ count }] = await sequelize.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM ${quoted}.products`,
        { type: QueryTypes.SELECT, transaction },
      );
      if (Number(count) > 0) throw new Error('已存在产品合规业务数据，不能安全回滚 APP/SDK 档案模板迁移');
      for (const [table, constraint] of [
        ['product_data_items', 'product_data_items_catalog_fk'],
      ]) await sequelize.query(`ALTER TABLE ${quoted}.${table} DROP CONSTRAINT IF EXISTS ${constraint}`, { transaction });
      for (const table of [
        'product_third_party_assessment_answers',
        'product_third_party_assessments',
        'product_third_party_services',
        'product_data_catalog_items',
      ]) await sequelize.query(`DROP TABLE IF EXISTS ${quoted}.${table}`, { transaction });
      for (const [table, columns] of [
        ['product_platform_permissions', ['operatingSystem']],
        ['product_data_items', ['catalogItemId', 'purpose', 'necessity', 'processingMethod', 'operatingSystems']],
        ['product_processing_activities', ['dataSource', 'writesToLog', 'dataScale', 'transferPath', 'transferEncryption', 'thirdPartyProcessor', 'thirdPartyProcessingAgreement', 'stored', 'storageSystem', 'storageLocation', 'storageEncryption', 'accessControl', 'anonymization', 'systemLogging', 'bulkExportAllowed', 'deletionMechanism', 'retentionBasis']],
      ] as const) {
        for (const column of columns) await sequelize.query(`ALTER TABLE ${quoted}.${table} DROP COLUMN IF EXISTS "${column}"`, { transaction });
      }
    },
  },
];

export function migrationChecksum(migration: Migration): string {
  return createHash('sha256')
    .update(`${migration.id}\n${migration.scope}\n${migration.description}\n${migration.checksumSource}`)
    .digest('hex');
}

export default migrations;
