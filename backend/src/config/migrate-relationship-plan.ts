#!/usr/bin/env -S npx tsx
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { QueryTypes, Transaction } from 'sequelize';
import sequelize from './database';
import { migrateUp } from './migrations/runner';
import Tenant from '../models/Tenant';
import {
  Asset,
  AssessmentAsset,
  AuditTask,
  QuestionItem,
  RemediationAction,
  RiskActionLink,
  RiskAffectedAsset,
  RiskRecord,
  RiskSource,
} from '../models';
import { runWithTenantContext } from '../middlewares/tenant';

interface AssetSpec {
  assetId?: string;
  createAsset?: {
    code: string;
    name: string;
    assetType: string;
    criticality?: 'low' | 'medium' | 'high' | 'critical';
    ownerDepartmentId?: string | null;
    ownerUserId?: string | null;
    description?: string | null;
  };
}

interface TenantMapping {
  tasks: Record<string, AssetSpec & {
    responsibleDepartmentId: string;
    evaluations?: Record<string, AssetSpec & { responsibleDepartmentId?: string }>;
  }>;
  risks: Record<string, {
    sourceEvaluationIds: string[];
    affectedAssetIds: string[];
    action?: {
      title?: string;
      description?: string;
      ownerUserId: string;
      ownerDepartmentId: string;
      dueDate: string;
      contributionDescription: string;
    };
  }>;
}

interface MappingFile {
  tenants: Record<string, TenantMapping>;
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function tableExists(schemaName: string, tableName: string): Promise<boolean> {
  const rows = await sequelize.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = :schemaName AND table_name = :tableName
     ) AS exists`,
    { replacements: { schemaName, tableName }, type: QueryTypes.SELECT },
  );
  return Boolean(rows[0]?.exists);
}

async function columnExists(schemaName: string, tableName: string, columnName: string): Promise<boolean> {
  const rows = await sequelize.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = :schemaName AND table_name = :tableName AND column_name = :columnName
     ) AS exists`,
    { replacements: { schemaName, tableName, columnName }, type: QueryTypes.SELECT },
  );
  return Boolean(rows[0]?.exists);
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function buildPlan(): Promise<Record<string, unknown>> {
  const output: Record<string, any> = {
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
    note: '补全映射后使用 --apply --mapping=<file>。工具不会根据 assessmentTarget 自动猜测资产。',
    tenants: {},
  };
  for (const tenant of await Tenant.findAll({ order: [['createdAt', 'ASC']] })) {
    const quoted = `"${tenant.schemaName.replace(/"/g, '""')}"`;
    if (!await tableExists(tenant.schemaName, 'audit_tasks')) {
      output.tenants[tenant.id] = { schemaName: tenant.schemaName, status: 'schema_missing' };
      continue;
    }
    const hasGraph = await tableExists(tenant.schemaName, 'assets');
    const hasLegacyRiskFields = await columnExists(tenant.schemaName, 'risk_records', 'riskIdentification');
    const tasks = await sequelize.query(
      `SELECT task.id, task."assessmentTarget", task.name, task."departmentId",
              count(item.id)::int AS evaluation_count
       FROM ${quoted}.audit_tasks task
       LEFT JOIN ${quoted}.question_items item ON item."taskId" = task.id
       GROUP BY task.id, task."assessmentTarget", task.name, task."departmentId"
       ORDER BY task."createdAt", task.id`,
      { type: QueryTypes.SELECT },
    );
    const risks = await sequelize.query(
      `SELECT risk.id, risk."taskId",
              ${hasLegacyRiskFields ? 'risk."questionItemId"' : 'NULL::uuid AS "questionItemId"'},
              ${hasLegacyRiskFields ? 'risk."riskIdentification"' : 'risk.description AS "riskIdentification"'},
              ${hasLegacyRiskFields ? 'risk."remediationMeasures"' : 'NULL::text AS "remediationMeasures"'}
       FROM ${quoted}.risk_records risk
       ORDER BY risk.id`,
      { type: QueryTypes.SELECT },
    );
    const evidenceCounts = await sequelize.query(
      `SELECT "questionItemId", count(*)::int AS count
       FROM ${quoted}.evidence_files
       WHERE "questionItemId" IS NOT NULL
       GROUP BY "questionItemId"
       ORDER BY "questionItemId"`,
      { type: QueryTypes.SELECT },
    );
    output.tenants[tenant.id] = {
      schemaName: tenant.schemaName,
      graphTablesPresent: hasGraph,
      tasks,
      risks,
      evidenceCounts,
      counts: {
        tasks: tasks.length,
        risks: risks.length,
        evidenceRelations: evidenceCounts.length,
      },
      hash: stableHash({ tasks, risks, evidenceCounts }),
    };
  }
  return output;
}

async function resolveAsset(
  spec: AssetSpec,
  transaction: Transaction,
): Promise<Asset> {
  if (spec.assetId) {
    const asset = await Asset.findOne({ where: { id: spec.assetId, status: 'active' }, transaction });
    if (!asset) throw new Error(`资产不存在或已归档: ${spec.assetId}`);
    return asset;
  }
  if (!spec.createAsset) throw new Error('任务映射必须提供 assetId 或 createAsset');
  const [asset] = await Asset.findOrCreate({
    where: { code: spec.createAsset.code },
    defaults: {
      ...spec.createAsset,
      criticality: spec.createAsset.criticality || 'medium',
      metadata: {},
      status: 'active',
    },
    transaction,
  });
  return asset;
}

async function nextCode(schemaName: string, sequence: string, prefix: string, transaction: Transaction): Promise<string> {
  const quotedSequence = `"${schemaName.replace(/"/g, '""')}"."${sequence}"`;
  const rows = await sequelize.query<{ value: string }>(
    `SELECT :prefix || '-' || to_char(CURRENT_DATE, 'YYYYMM') || '-' ||
       lpad(nextval('${quotedSequence}')::text, 6, '0') AS value`,
    { replacements: { prefix }, type: QueryTypes.SELECT, transaction },
  );
  return rows[0].value;
}

async function applyTenantMapping(tenantId: string, mapping: TenantMapping): Promise<Record<string, unknown>> {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new Error(`映射包含不存在的租户: ${tenantId}`);
  return runWithTenantContext(
    { schema: tenant.schemaName, tenantId },
    () => sequelize.transaction(async (transaction) => {
      for (const [taskId, taskMapping] of Object.entries(mapping.tasks || {})) {
        const task = await AuditTask.findByPk(taskId, { transaction });
        if (!task) throw new Error(`租户 ${tenantId} 找不到任务 ${taskId}`);
        const defaultAsset = await resolveAsset(taskMapping, transaction);
        await AssessmentAsset.upsert({
          taskId,
          assetId: defaultAsset.id,
          scopeStatus: 'included',
          assetCodeSnapshot: defaultAsset.code,
          assetNameSnapshot: defaultAsset.name,
          assetTypeSnapshot: defaultAsset.assetType,
          criticalitySnapshot: defaultAsset.criticality,
          ownerDepartmentIdSnapshot: defaultAsset.ownerDepartmentId,
          addedBy: task.createdBy,
        }, { transaction });
        const evaluations = await QuestionItem.findAll({ where: { taskId }, transaction });
        for (const evaluation of evaluations) {
          const evaluationMapping = taskMapping.evaluations?.[evaluation.id];
          const asset = evaluationMapping
            ? await resolveAsset(evaluationMapping, transaction)
            : defaultAsset;
          if (evaluationMapping && asset.id !== defaultAsset.id) {
            await AssessmentAsset.upsert({
              taskId,
              assetId: asset.id,
              scopeStatus: 'included',
              assetCodeSnapshot: asset.code,
              assetNameSnapshot: asset.name,
              assetTypeSnapshot: asset.assetType,
              criticalitySnapshot: asset.criticality,
              ownerDepartmentIdSnapshot: asset.ownerDepartmentId,
              addedBy: task.createdBy,
            }, { transaction });
          }
          await evaluation.update({
            assetId: asset.id,
            responsibleDepartmentId: evaluationMapping?.responsibleDepartmentId ||
              taskMapping.responsibleDepartmentId,
          }, { transaction });
        }
      }

      for (const [riskId, riskMapping] of Object.entries(mapping.risks || {})) {
        if (!riskMapping.sourceEvaluationIds?.length || !riskMapping.affectedAssetIds?.length) {
          throw new Error(`风险 ${riskId} 必须显式提供来源评估和受影响资产`);
        }
        const risk = await RiskRecord.findByPk(riskId, { transaction });
        if (!risk) throw new Error(`租户 ${tenantId} 找不到风险 ${riskId}`);
        const sourceCount = await QuestionItem.count({
          where: { id: riskMapping.sourceEvaluationIds },
          transaction,
        });
        if (sourceCount !== riskMapping.sourceEvaluationIds.length) {
          throw new Error(`风险 ${riskId} 包含不存在的来源评估`);
        }
        const assetCount = await Asset.count({
          where: { id: riskMapping.affectedAssetIds },
          transaction,
        });
        if (assetCount !== riskMapping.affectedAssetIds.length) {
          throw new Error(`风险 ${riskId} 包含不存在的受影响资产`);
        }
        await RiskSource.bulkCreate(
          riskMapping.sourceEvaluationIds.map((controlEvaluationId, index) => ({
            riskId,
            controlEvaluationId,
            relationType: index === 0 ? 'primary' : 'supporting',
            rationale: '历史关系显式迁移',
            createdBy: risk.ownerUserId,
          })),
          { transaction, ignoreDuplicates: true },
        );
        await RiskAffectedAsset.bulkCreate(
          riskMapping.affectedAssetIds.map((assetId) => ({
            riskId,
            assetId,
            impactDescription: '历史关系显式迁移',
            createdBy: risk.ownerUserId,
          })),
          { transaction, ignoreDuplicates: true },
        );

        const hasLegacyRemediation = await columnExists(
          tenant.schemaName,
          'risk_records',
          'remediationMeasures',
        );
        const legacyRows = hasLegacyRemediation
          ? await sequelize.query<{ remediationMeasures: string | null }>(
            `SELECT "remediationMeasures" FROM "${tenant.schemaName.replace(/"/g, '""')}".risk_records WHERE id = :riskId`,
            { replacements: { riskId }, type: QueryTypes.SELECT, transaction },
          )
          : [];
        const legacyMeasure = legacyRows[0]?.remediationMeasures?.trim();
        if (legacyMeasure && !riskMapping.action) {
          throw new Error(`风险 ${riskId} 存在旧整改措施，mapping.action 必填`);
        }
        if (riskMapping.action) {
          const action = await RemediationAction.create({
            code: await nextCode(tenant.schemaName, 'remediation_action_code_seq', 'ACT', transaction),
            title: riskMapping.action.title || `整改 ${risk.code}`,
            description: riskMapping.action.description || legacyMeasure || riskMapping.action.contributionDescription,
            ownerUserId: riskMapping.action.ownerUserId,
            ownerDepartmentId: riskMapping.action.ownerDepartmentId,
            dueDate: new Date(riskMapping.action.dueDate),
            createdBy: risk.ownerUserId,
          }, { transaction });
          await RiskActionLink.create({
            riskId,
            actionId: action.id,
            isRequired: true,
            contributionDescription: riskMapping.action.contributionDescription,
          }, { transaction });
        }
      }

      const counts = {
        evaluations: await QuestionItem.count({ transaction }),
        risks: await RiskRecord.count({ transaction }),
        riskSources: await RiskSource.count({ transaction }),
        affectedAssets: await RiskAffectedAsset.count({ transaction }),
        actions: await RemediationAction.count({ transaction }),
        actionLinks: await RiskActionLink.count({ transaction }),
      };
      return { tenantId, counts, hash: stableHash(counts) };
    }),
  );
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  if (!apply) {
    process.stdout.write(`${JSON.stringify(await buildPlan(), null, 2)}\n`);
    return;
  }
  const mappingPath = argValue('mapping');
  if (!mappingPath) throw new Error('--apply 必须同时提供 --mapping=<json 文件>');
  try {
    await migrateUp();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('关系图迁移仍有未映射数据')) throw error;
  }
  const mapping = JSON.parse(readFileSync(mappingPath, 'utf8')) as MappingFile;
  const results = [];
  for (const [tenantId, tenantMapping] of Object.entries(mapping.tenants || {})) {
    results.push(await applyTenantMapping(tenantId, tenantMapping));
  }
  await migrateUp();
  process.stdout.write(`${JSON.stringify({ ok: true, applied: true, results }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
