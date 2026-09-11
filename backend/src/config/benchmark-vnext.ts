#!/usr/bin/env -S npx tsx
import { randomUUID } from 'crypto';
import sequelize from './database';
import { setupAssociations } from '../models/associations';
import {
  Asset,
  AssessmentType,
  AssessmentAsset,
  AssessmentControlAsset,
  AuditTask,
  Department,
  QuestionItem,
  QuestionnaireTemplate,
  QuestionTemplate,
  TenantMember,
  TaskStatus,
  User,
} from '../models';
import { runWithTenantContext } from '../middlewares/tenant';
import tenantProvisioningService from '../services/tenant-provisioning.service';
import assessmentScopeService from '../services/assessment-scope.service';
import evaluationService from '../services/evaluation.service';
import reportingService from '../services/reporting.service';

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function measure(operation: () => Promise<unknown>, iterations = 7): Promise<number> {
  const durations: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    await operation();
    const elapsed = performance.now() - started;
    if (index > 0) durations.push(elapsed);
  }
  return percentile(durations, 0.95);
}

async function main(): Promise<void> {
  if (process.env.BENCHMARK_CONFIRM !== 'temporary-only') {
    throw new Error('仅允许在临时数据库执行：设置 BENCHMARK_CONFIRM=temporary-only');
  }
  setupAssociations();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const provisioned = await tenantProvisioningService.provision({
    name: 'vNext 性能基线',
    slug: `benchmark_${suffix}`,
    admin: { username: `benchmark_${suffix}`, displayName: '性能基线管理员' },
  });
  const tenant = provisioned.tenant;
  const user = await User.findOne({ where: { username: `benchmark_${suffix}` } });
  if (!user) throw new Error('性能基线用户创建失败');

  const result = await runWithTenantContext(
    { schema: tenant.schemaName, tenantId: tenant.id },
    async () => {
      const [department, member] = await Promise.all([
        Department.findOne({ where: { code: 'ROOT' } }),
        TenantMember.findOne({ where: { userId: user.id } }),
      ]);
      if (!department || !member) throw new Error('性能基线租户初始化不完整');
      const requestUser = {
        userId: user.id,
        memberId: member.id,
        tenantId: tenant.id,
        roleIds: [],
        isGlobalAdmin: true,
        permissions: {
          tasks: ['read', 'update'],
          evaluations: ['read'],
          risks: ['read'],
          remediation_actions: ['read'],
          qualifications: ['read'],
          templates: ['read'],
        },
        permissionScopes: {},
        departmentIds: [department.id],
        primaryDepartmentId: department.id,
      } as any;
      const template = await QuestionnaireTemplate.create({
        name: '10万评估单元基线标准',
        description: null,
        createdBy: user.id,
        questionCount: 100,
      });
      const controls = await QuestionTemplate.bulkCreate(Array.from({ length: 100 }, (_, index) => ({
        templateId: template.id,
        sequenceNumber: `B.${index + 1}`,
        controlDomain: '性能基线',
        controlPoint: `性能基线控制项 ${index + 1}`,
        referenceAnswer: null,
        historicalEvidencePath: null,
        responsibleDepartment: null,
        responsiblePerson: null,
        extraData: null,
      })));
      const assets = await Asset.bulkCreate(Array.from({ length: 1000 }, (_, index) => ({
        code: `BENCH-${String(index + 1).padStart(4, '0')}`,
        name: `性能基线资产 ${index + 1}`,
        assetType: 'application',
        criticality: 'medium',
        ownerDepartmentId: department.id,
        ownerUserId: user.id,
        metadata: {},
        status: 'active',
      })));
      const largeTask = await AuditTask.create({
        name: '10万评估单元查询基线',
        templateId: template.id,
        assessmentType: AssessmentType.ISO27001,
        assessmentTarget: '10万评估单元查询基线',
        createdBy: user.id,
        assignedTo: user.id,
        reviewerId: user.id,
        departmentId: department.id,
        status: TaskStatus.PENDING_CLOSURE,
        publishedAt: new Date(),
      });
      const schema = tenant.schemaName.replace(/"/g, '""');
      await sequelize.query(`
        INSERT INTO "${schema}".question_items
          (id, "taskId", "templateQuestionId", "assetId", "sequenceNumber",
           "controlDomain", "controlPoint", "referenceAnswer", "historicalEvidencePath",
           "responsibleDepartment", "responsiblePerson", "responsibleDepartmentId",
           "currentStatusDescription", "answerStatus", "workflowStatus",
           "complianceStatus", "assignedTo", "reviewedBy", "answeredAt",
           "submittedAt", "reviewedAt", "lockVersion")
        SELECT gen_random_uuid(), :taskId, control.id, asset.id, control."sequenceNumber",
          control."controlDomain", control."controlPoint", NULL, NULL, NULL, NULL,
          :departmentId, NULL, 'answered', 'reviewed', 'compliant', :userId, :userId,
          now(), now(), now(), 0
        FROM "${schema}".question_templates control
        CROSS JOIN "${schema}".assets asset
        WHERE control."templateId" = :templateId AND asset.code LIKE 'BENCH-%'
      `, {
        replacements: {
          taskId: largeTask.id,
          templateId: template.id,
          departmentId: department.id,
          userId: user.id,
        },
      });
      const evaluationCount = await QuestionItem.count({ where: { taskId: largeTask.id } });
      if (evaluationCount !== 100_000) throw new Error(`期望 100000 个评估单元，实际 ${evaluationCount}`);

      const listP95Ms = await measure(
        () => evaluationService.list(largeTask.id, { page: 2500, pageSize: 20 }, requestUser),
      );
      const dashboardP95Ms = await measure(() => reportingService.dashboard(requestUser));

      const publishTask = await AuditTask.create({
        name: '1万评估单元发布基线',
        templateId: template.id,
        assessmentType: AssessmentType.ISO27001,
        assessmentTarget: '1万评估单元发布基线',
        createdBy: user.id,
        assignedTo: user.id,
        reviewerId: user.id,
        departmentId: department.id,
        status: TaskStatus.PREPARING,
      });
      const publishAssets = assets.slice(0, 100);
      await AssessmentAsset.bulkCreate(publishAssets.map((asset) => ({
        taskId: publishTask.id,
        assetId: asset.id,
        scopeStatus: 'included',
        assetCodeSnapshot: asset.code,
        assetNameSnapshot: asset.name,
        assetTypeSnapshot: asset.assetType,
        criticalitySnapshot: asset.criticality,
        ownerDepartmentIdSnapshot: asset.ownerDepartmentId,
        addedBy: user.id,
      })));
      await AssessmentControlAsset.bulkCreate(controls.flatMap((control) => publishAssets.map((asset) => ({
        id: randomUUID(),
        taskId: publishTask.id,
        controlPointId: control.id,
        assetId: asset.id,
        assignedTo: user.id,
        responsibleDepartmentId: department.id,
      }))));
      const publishStarted = performance.now();
      await assessmentScopeService.publish(publishTask.id, requestUser);
      const publishMs = performance.now() - publishStarted;
      const publishedCount = await QuestionItem.count({ where: { taskId: publishTask.id } });

      return {
        tenantSchema: tenant.schemaName,
        evaluationCount,
        listP95Ms: Math.round(listP95Ms * 100) / 100,
        dashboardP95Ms: Math.round(dashboardP95Ms * 100) / 100,
        publishedCount,
        publishMs: Math.round(publishMs * 100) / 100,
        thresholds: {
          listP95Ms: 500,
          dashboardP95Ms: 1000,
          publishMs: 60_000,
        },
      };
    },
  );
  if (result.listP95Ms >= 500 || result.dashboardP95Ms >= 1000
    || result.publishedCount !== 10_000 || result.publishMs >= 60_000) {
    throw new Error(`性能门禁失败: ${JSON.stringify(result)}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
