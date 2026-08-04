import sequelize from './database';
import { TaskSchedule, Tenant } from '../models';
import { runWithTenantContext } from '../middlewares/tenant';
import questionnaireService from '../services/questionnaire.service';

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(identifier)) throw new Error(`非法数据库标识符: ${identifier}`);
  return `"${identifier}"`;
}

async function migrateTenantSchema(schemaName: string): Promise<void> {
  const schema = quoteIdentifier(schemaName);
  await sequelize.query(`
    ALTER TABLE IF EXISTS ${schema}.evidence_files
      ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS sha256 VARCHAR(64),
      ADD COLUMN IF NOT EXISTS "scanStatus" VARCHAR(20) NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS "isLocked" BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS "supersedesId" UUID,
      ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS "deletedBy" UUID;

    DROP INDEX IF EXISTS ${schema}.uq_evidence_files_historical_question;

    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY "questionItemId", "evidenceType"
        ORDER BY "uploadedAt", id
      ) AS version_number
      FROM ${schema}.evidence_files
    )
    UPDATE ${schema}.evidence_files evidence
       SET version = ranked.version_number
      FROM ranked
     WHERE evidence.id = ranked.id;

    CREATE INDEX IF NOT EXISTS idx_evidence_files_question_type_status
      ON ${schema}.evidence_files ("questionItemId", "evidenceType", status);
    CREATE INDEX IF NOT EXISTS idx_evidence_files_question_type_version
      ON ${schema}.evidence_files ("questionItemId", "evidenceType", version);
    CREATE INDEX IF NOT EXISTS idx_evidence_files_sha256
      ON ${schema}.evidence_files (sha256);

    ALTER TABLE IF EXISTS ${schema}.account_task_executions
      ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS "maxAttempts" INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(180),
      ADD COLUMN IF NOT EXISTS "heartbeatAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();

    WITH duplicate_running AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY "taskId" ORDER BY "startTime" DESC, id DESC) AS row_number
      FROM ${schema}.account_task_executions
      WHERE status = 'RUNNING'
    )
    UPDATE ${schema}.account_task_executions execution
       SET status = 'FAILED', "endTime" = NOW(), "errorMessage" = '迁移时回收重复运行记录'
      FROM duplicate_running duplicate
     WHERE execution.id = duplicate.id AND duplicate.row_number > 1;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_task_execution_idempotency
      ON ${schema}.account_task_executions ("idempotencyKey")
      WHERE "idempotencyKey" IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_task_execution_running
      ON ${schema}.account_task_executions ("taskId")
      WHERE status = 'RUNNING';
    CREATE INDEX IF NOT EXISTS idx_task_execution_status_heartbeat
      ON ${schema}.account_task_executions (status, "heartbeatAt");
  `);
}

export async function migrateP0Abde(): Promise<void> {
  await TaskSchedule.sync();
  const tenants = await Tenant.findAll({ attributes: ['id', 'schemaName'] });
  const contexts = [
    { schema: 'public', tenantId: null as string | null },
    ...tenants.map(tenant => ({ schema: tenant.schemaName, tenantId: tenant.id as string | null })),
  ];

  for (const context of contexts) {
    await migrateTenantSchema(context.schema);
    await runWithTenantContext(context, async () => {
      const historical = await questionnaireService.migrateLegacyHistoricalEvidence();
      const integrity = await questionnaireService.migrateEvidenceIntegrity();
      console.log(`[P0 migration] ${context.schema}`, { historical, integrity });
    });
  }
}
