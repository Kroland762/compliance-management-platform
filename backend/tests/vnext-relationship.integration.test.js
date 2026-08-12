const runIntegration = process.env.RUN_PG_INTEGRATION === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('vNext assessment, risk and remediation relationship graph', () => {
  let sequelize;
  let runWithTenantContext;
  let tenant;
  let user;
  let auditorUser;
  let auditorTwo;
  let department;
  let requestUser;
  let requestAuditor;
  let requestAuditorTwo;
  let template;
  let controls;
  let assets;
  let task;
  let evaluations;
  let matrixEntries;
  let suffix;

  beforeAll(async () => {
    sequelize = require('../src/config/database').default;
    const { setupAssociations } = require('../src/models/associations');
    setupAssociations();
    const { migrateUp } = require('../src/config/migrations/runner');
    const provisioning = require('../src/services/tenant-provisioning.service').default;
    runWithTenantContext = require('../src/middlewares/tenant').runWithTenantContext;
    const {
      Asset,
      AssessmentAuditor,
      Department,
      QuestionTemplate,
      QuestionnaireTemplate,
      TenantMember,
      User,
    } = require('../src/models');
    const taskService = require('../src/services/task.service').default;
    const scopeService = require('../src/services/assessment-scope.service').default;

    await migrateUp();
    suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const result = await provisioning.provision({
      name: '关系图集成租户',
      slug: `graph_${suffix}`,
      admin: { username: `graph_admin_${suffix}`, displayName: '关系图管理员' },
    });
    tenant = result.tenant;
    user = await User.findOne({ where: { username: `graph_admin_${suffix}` } });
    auditorUser = await User.create({
      username: `graph_auditor_${suffix}`,
      passwordHash: 'integration-test-only',
      email: null,
      isActive: true,
    });
    auditorTwo = await User.create({
      username: `graph_auditor_two_${suffix}`,
      passwordHash: 'integration-test-only',
      email: null,
      isActive: true,
    });

    await runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, async () => {
      const member = await TenantMember.findOne({ where: { userId: user.id } });
      department = await Department.findOne({ where: { code: 'ROOT' } });
      requestUser = {
        userId: user.id,
        memberId: member.id,
        tenantId: tenant.id,
        roleIds: [],
        isGlobalAdmin: true,
        permissions: {},
        permissionScopes: {},
        departmentIds: [department.id],
        primaryDepartmentId: department.id,
      };
      requestAuditor = {
        userId: auditorUser.id,
        tenantId: tenant.id,
        roleIds: [],
        isGlobalAdmin: false,
        permissions: {
          tasks: ['read'], evaluations: ['read', 'claim', 'review'], findings: ['read', 'verify'],
          risks: ['read', 'verify', 'close'], remediation_actions: ['read', 'verify'],
        },
        permissionScopes: {
          tasks: { read: 'assigned' }, evaluations: { read: 'assigned', claim: 'assigned', review: 'assigned' },
          findings: { read: 'assigned', verify: 'assigned' }, risks: { read: 'assigned', verify: 'assigned', close: 'assigned' },
          remediation_actions: { read: 'assigned', verify: 'assigned' },
        },
        departmentIds: [department.id],
        primaryDepartmentId: department.id,
      };
      requestAuditorTwo = { ...requestAuditor, userId: auditorTwo.id };
      template = await QuestionnaireTemplate.create({
        name: '关系图标准',
        description: null,
        createdBy: user.id,
        questionCount: 2,
        standardSeriesKey: `relationship-${suffix}`,
        version: '1.0',
        columnSchema: [
          { key: 'sequenceNumber', label: '序号', source: 'core', visible: true, width: 100 },
          { key: 'controlPoint', label: '控制点', source: 'core', visible: true, width: 320 },
        ],
      });
      controls = await QuestionTemplate.bulkCreate([
        {
          templateId: template.id,
          sequenceNumber: 'A.1',
          controlDomain: '访问控制',
          controlPoint: '身份鉴别',
          referenceAnswer: null,
          historicalEvidencePath: null,
          responsibleDepartment: null,
          responsiblePerson: null,
          extraData: null,
        },
        {
          templateId: template.id,
          sequenceNumber: 'A.2',
          controlDomain: '访问控制',
          controlPoint: '权限复核',
          referenceAnswer: null,
          historicalEvidencePath: null,
          responsibleDepartment: null,
          responsiblePerson: null,
          extraData: null,
        },
      ]);
      assets = await Asset.bulkCreate([
        { code: `APP-${suffix}`, name: '核心应用', assetType: 'application', criticality: 'high', status: 'active' },
        { code: `DB-${suffix}`, name: '核心数据库', assetType: 'data', criticality: 'critical', status: 'active' },
        { code: `ORG-${suffix}`, name: '组织治理', assetType: 'organization', criticality: 'high', status: 'active' },
      ]);
      task = await taskService.createTask({
        templateId: template.id,
        assessmentType: 'ISO 27001',
        name: '多资产评估',
        assessmentTarget: '多资产评估',
        departmentId: department.id,
        createdBy: user.id,
      });
      await AssessmentAuditor.create({ taskId: task.id, auditorUserId: auditorUser.id, assignedBy: user.id });
      await AssessmentAuditor.create({ taskId: task.id, auditorUserId: auditorTwo.id, assignedBy: user.id });
      await scopeService.replaceAssets(task.id, assets.map((asset) => asset.id), requestUser);
      matrixEntries = [
        [controls[0], assets[0]],
        [controls[0], assets[1]],
        [controls[1], assets[1]],
        [controls[1], assets[2]],
      ].map(([control, asset]) => ({
        controlPointId: control.id,
        assetId: asset.id,
        assignedTo: user.id,
        responsibleDepartmentId: department.id,
      }));
      await scopeService.replaceMatrix(task.id, matrixEntries, requestUser);
      await scopeService.publish(task.id, requestUser);
      evaluations = await require('../src/models').QuestionItem.findAll({ where: { taskId: task.id } });
    });
  }, 90_000);

  afterAll(async () => {
    if (sequelize && suffix) {
      const schemaName = `tenant_graph_${suffix}`;
      if (/^tenant_graph_[a-z0-9_]+$/.test(schemaName)) {
        require('../src/services/account/cronScheduler.service').default.shutdown();
        await sequelize.query('DELETE FROM public.task_schedules WHERE "tenantSchema" = :schemaName', {
          replacements: { schemaName },
        }).catch(() => undefined);
        await sequelize.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => undefined);
        await sequelize.query('DELETE FROM public.schema_migrations WHERE schema_name = :schemaName', {
          replacements: { schemaName },
        }).catch(() => undefined);
        await sequelize.query('DELETE FROM public.tenants WHERE slug = :slug', {
          replacements: { slug: `graph_${suffix}` },
        }).catch(() => undefined);
        await sequelize.query(`DELETE FROM public.users
          WHERE username IN (:admin, :auditor, :auditorTwo)`, {
          replacements: {
            admin: `graph_admin_${suffix}`,
            auditor: `graph_auditor_${suffix}`,
            auditorTwo: `graph_auditor_two_${suffix}`,
          },
        }).catch(() => undefined);
      }
    }
    await sequelize.close();
  });

  test('publishing a sparse 2 x 3 matrix creates four stable, unique evaluations and is idempotent', async () => {
    const scopeService = require('../src/services/assessment-scope.service').default;
    await runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, async () => {
      expect(evaluations).toHaveLength(4);
      expect(new Set(evaluations.map((item) => `${item.templateQuestionId}:${item.assetId}`)).size).toBe(4);
      const repeated = await scopeService.publish(task.id, requestUser);
      expect(repeated.created).toBe(0);
      expect(repeated.total).toBe(4);
    });
  });

  test('publishing without a matrix creates one multi-asset spreadsheet row per control and supports split plus atomic bulk submit', async () => {
    const { AssessmentAuditor, AuditTask, EvaluationAsset, QuestionItem } = require('../src/models');
    const taskService = require('../src/services/task.service').default;
    const scopeService = require('../src/services/assessment-scope.service').default;
    const evaluationService = require('../src/services/evaluation.service').default;
    await runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, async () => {
      const sheetTask = await taskService.createTask({
        templateId: template.id,
        assessmentType: 'ISO 27001',
        name: '表格式多资产评估',
        assessmentTarget: '表格式多资产评估',
        departmentId: department.id,
        assignedTo: user.id,
        createdBy: user.id,
      });
      await AssessmentAuditor.create({ taskId: sheetTask.id, auditorUserId: auditorUser.id, assignedBy: user.id });
      await scopeService.replaceAssets(sheetTask.id, assets.map((asset) => asset.id), requestUser);
      const published = await scopeService.publish(sheetTask.id, requestUser);
      expect(published.created).toBe(2);
      expect((await AuditTask.findByPk(sheetTask.id)).columnSchemaSnapshot).toHaveLength(2);
      let rows = await QuestionItem.findAll({ where: { taskId: sheetTask.id }, order: [['sequenceNumber', 'ASC']] });
      expect(rows).toHaveLength(2);
      expect(await EvaluationAsset.count({ where: { taskId: sheetTask.id } })).toBe(6);
      const listed = await evaluationService.list(sheetTask.id, { page: 1, pageSize: 100 }, requestUser);
      expect(listed.items.every((item) => item.assets.length === 3)).toBe(true);
      expect(await evaluationService.history(rows[0].id, requestUser)).toEqual([]);

      const firstAnswered = await evaluationService.answer(rows[0].id, '共享回答草稿', rows[0].lockVersion, requestUser);
      const split = await evaluationService.split(rows[0].id, [assets[0].id], firstAnswered.lockVersion, requestUser);
      expect(split.original.assets).toHaveLength(2);
      expect(split.created.assets).toHaveLength(1);
      expect(split.created.currentStatusDescription).toBe('共享回答草稿');
      expect(split.created.evidenceFiles).toEqual([]);
      const secondAnswered = await evaluationService.answer(rows[1].id, '第二个控制项回答', rows[1].lockVersion, requestUser);
      await evaluationService.bulkSubmit(sheetTask.id, [
        { id: split.original.id, lockVersion: split.original.lockVersion },
        { id: split.created.id, lockVersion: split.created.lockVersion },
        { id: secondAnswered.id, lockVersion: secondAnswered.lockVersion },
      ], requestUser);
      rows = await QuestionItem.findAll({ where: { taskId: sheetTask.id } });
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.workflowStatus === 'submitted')).toBe(true);
    });
  }, 30_000);

  test('an assigned auditor or administrator can self-review while an ordinary respondent cannot', async () => {
    const { QuestionItem } = require('../src/models');
    const evaluationService = require('../src/services/evaluation.service').default;
    await runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, async () => {
      const item = await QuestionItem.findByPk(evaluations[2].id);
      const answered = await evaluationService.answer(item.id, '管理员直接填写并复核', item.lockVersion, requestUser);
      await evaluationService.submit(item.id, requestUser, answered.lockVersion);
      const ordinaryRespondent = { ...requestUser, isGlobalAdmin: false, permissions: { evaluations: ['read', 'answer', 'submit'] } };
      await expect(evaluationService.claimReview(item.id, ordinaryRespondent))
        .rejects.toMatchObject({ code: 'SELF_REVIEW_FORBIDDEN' });
      const claimed = await evaluationService.claimReview(item.id, requestUser);
      const reviewed = await evaluationService.review(item.id, { complianceStatus: 'compliant' }, requestUser, claimed.lockVersion);
      expect(reviewed.workflowStatus).toBe('reviewed');
      expect(reviewed.complianceStatus).toBe('compliant');
    });
  }, 30_000);

  test('shared review pool has atomic claims and creates one finding', async () => {
    const { Finding, QuestionItem } = require('../src/models');
    const evaluationService = require('../src/services/evaluation.service').default;
    await runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, async () => {
      const item = await QuestionItem.findByPk(evaluations[0].id);
      const answered = await evaluationService.answer(item.id, '当前身份鉴别控制存在差距', item.lockVersion, requestUser);
      await evaluationService.submit(item.id, requestUser, answered.lockVersion);
      const claims = await Promise.allSettled([
        evaluationService.claimReview(item.id, requestAuditor),
        evaluationService.claimReview(item.id, requestAuditorTwo),
      ]);
      expect(claims.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const winner = claims[0].status === 'fulfilled' ? requestAuditor : requestAuditorTwo;
      const claimed = await QuestionItem.findByPk(item.id);
      const reviewed = await evaluationService.review(item.id, {
        complianceStatus: 'non_compliant',
        finding: { description: '未按控制要求完成身份鉴别', severity: 'high' },
      }, winner, claimed.lockVersion);
      expect(reviewed.workflowStatus).toBe('reviewed');
      expect(await Finding.count({ where: { evaluationId: item.id } })).toBe(1);
      await expect(evaluationService.review(item.id, {
        complianceStatus: 'non_compliant',
        finding: { description: '重复记录', severity: 'high' },
      }, winner, reviewed.lockVersion)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await Finding.count({ where: { evaluationId: item.id } })).toBe(1);
      await Finding.update({ status: 'resolved', resolvedBy: winner.userId, resolvedAt: new Date() }, { where: { evaluationId: item.id } });
    });
  }, 30_000);

  test('direct remediation resolves a finding only after independent verification', async () => {
    const { EvidenceFile, Finding, QuestionItem } = require('../src/models');
    const evaluationService = require('../src/services/evaluation.service').default;
    const findingService = require('../src/services/finding.service').default;
    const remediationService = require('../src/services/remediation.service').default;
    await runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, async () => {
      const item = await QuestionItem.findByPk(evaluations[1].id);
      const answered = await evaluationService.answer(item.id, '权限复核频率不足', item.lockVersion, requestUser);
      await evaluationService.submit(item.id, requestUser, answered.lockVersion);
      const claimed = await evaluationService.claimReview(item.id, requestAuditor);
      await evaluationService.review(item.id, {
        complianceStatus: 'partial',
        finding: { description: '权限复核未覆盖全部特权账号', severity: 'medium' },
      }, requestAuditor, claimed.lockVersion);
      const finding = await Finding.findOne({ where: { evaluationId: item.id } });
      const findingWithAction = await findingService.remediate(finding.id, {
        title: '补充特权账号复核',
        description: '补齐清单并完成二次复核',
        ownerUserId: user.id,
        ownerDepartmentId: department.id,
        dueDate: new Date(Date.now() + 7 * 86400000),
      }, requestAuditor, finding.lockVersion, `finding-remediate-${finding.id}`);
      const action = findingWithAction.actionLinks[0].action;
      const progressed = await remediationService.update(
        action.id,
        { progressNote: '已补齐复核清单并完成抽样验证' },
        requestUser,
        action.lockVersion,
      );
      await EvidenceFile.create({
        questionItemId: null,
        remediationActionId: action.id,
        originalFilename: 'finding-remediation.txt',
        storedFilename: null,
        filePath: null,
        storageKey: `tenants/${tenant.id}/test/finding-remediation.txt`,
        sha256: 'b'.repeat(64),
        status: 'active',
        deletedAt: null,
        evidenceType: 'remediation',
        evidencePurpose: 'remediation',
        fileSize: 1,
        mimeType: 'text/plain',
        uploadedBy: user.id,
      });
      const submitted = await remediationService.submit(
        action.id,
        requestUser,
        progressed.lockVersion,
        `finding-submit-${action.id}`,
      );
      expect((await Finding.findByPk(finding.id)).status).toBe('remediating');
      await findingService.verifyAction(
        finding.id,
        action.id,
        { decision: 'approved', comment: '证据与抽样结果通过' },
        requestAuditor,
        submitted.lockVersion,
      );
      expect((await Finding.findByPk(finding.id)).status).toBe('resolved');
    });
  }, 30_000);

  test('risks support multiple sources and assets while one action independently verifies two risks', async () => {
    const {
      EvidenceFile,
      QuestionItem,
      RemediationAction,
      RiskActionLink,
      RiskLifecycleStatus,
      RiskRecord,
    } = require('../src/models');
    const riskService = require('../src/services/risk-domain.service').default;
    const remediationService = require('../src/services/remediation.service').default;

    await runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, async () => {
      await QuestionItem.update({
        workflowStatus: 'reviewed',
        complianceStatus: 'non_compliant',
        reviewedBy: user.id,
        reviewedAt: new Date(),
      }, { where: { taskId: task.id } });
      const sourceRows = await QuestionItem.findAll({ where: { taskId: task.id }, order: [['sequenceNumber', 'ASC']] });
      const firstInput = {
        taskId: task.id,
        title: '共享身份权限风险',
        description: '多个控制项共同形成风险',
        riskLevel: 'high',
        ownerDepartmentId: department.id,
        ownerUserId: user.id,
        sources: sourceRows.slice(0, 2).map((item) => ({ controlEvaluationId: item.id })),
        assets: assets.map((asset) => ({ assetId: asset.id })),
      };
      const first = await riskService.create(firstInput, requestUser, `risk-first-${task.id}`);
      const firstReplay = await riskService.create(firstInput, requestUser, `risk-first-${task.id}`);
      expect(firstReplay.id).toBe(first.id);
      const second = await riskService.create({
        taskId: task.id,
        title: '数据库权限风险',
        description: '单个控制项影响数据库资产',
        riskLevel: 'medium',
        ownerDepartmentId: department.id,
        ownerUserId: user.id,
        sources: [{ controlEvaluationId: sourceRows[2].id }],
        assets: [{ assetId: assets[1].id }],
      }, requestUser, `risk-second-${task.id}`);
      await riskService.confirm(first.id, requestUser, first.lockVersion);
      await riskService.confirm(second.id, requestUser, second.lockVersion);
      const action = await remediationService.create({
        title: '统一收敛权限',
        description: '一次行动降低两个风险',
        ownerUserId: user.id,
        ownerDepartmentId: department.id,
        dueDate: new Date(Date.now() + 86400000),
        riskLinks: [
          { riskId: first.id, contributionDescription: '收敛共享身份' },
          { riskId: second.id, contributionDescription: '收敛数据库权限' },
        ],
      }, requestUser);
      const actionWithProgress = await remediationService.update(
        action.id,
        { progressNote: '已完成权限收敛并验证结果' },
        requestUser,
        action.lockVersion,
      );
      await EvidenceFile.create({
        questionItemId: null,
        remediationActionId: action.id,
        originalFilename: 'remediation.txt',
        storedFilename: null,
        filePath: null,
        storageKey: `tenants/${tenant.id}/test/remediation.txt`,
        sha256: 'a'.repeat(64),
        status: 'active',
        deletedAt: null,
        evidenceType: 'remediation',
        evidencePurpose: 'remediation',
        fileSize: 1,
        mimeType: 'text/plain',
        uploadedBy: user.id,
      });
      const submitted = await remediationService.submit(
        action.id,
        requestUser,
        actionWithProgress.lockVersion,
        `submit-${action.id}`,
      );
      const afterFirstVerification = await remediationService.verify(
        first.id,
        action.id,
        { decision: 'approved', comment: '风险一通过' },
        requestAuditor,
        submitted.lockVersion,
      );
      expect((await RemediationAction.findByPk(action.id)).status).toBe('pending_verification');
      await remediationService.verify(
        second.id,
        action.id,
        { decision: 'approved', comment: '风险二通过' },
        requestAuditor,
        afterFirstVerification.lockVersion,
      );
      expect((await RemediationAction.findByPk(action.id)).status).toBe('completed');
      expect(await RiskActionLink.count({ where: { actionId: action.id, verificationStatus: 'approved' } })).toBe(2);
      const closable = await RiskRecord.findByPk(first.id);
      await riskService.close(first.id, '验证关闭门禁', requestAuditor, closable.lockVersion);
      expect((await RiskRecord.findByPk(first.id)).status).toBe(RiskLifecycleStatus.CLOSED);
      expect((await riskService.detail(first.id, requestUser)).sources).toHaveLength(2);
      expect((await riskService.detail(first.id, requestUser)).affectedAssets).toHaveLength(3);
    });
  }, 30_000);

  test('review completion is independent from disposition, while assessment close waits for findings', async () => {
    const {
      AuditTask,
      Finding,
      QuestionItem,
      RiskRecord,
    } = require('../src/models');
    const riskService = require('../src/services/risk-domain.service').default;
    const lifecycleService = require('../src/services/task-lifecycle.service').default;
    await runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, async () => {
      const rows = await QuestionItem.findAll({ where: { taskId: task.id }, order: [['sequenceNumber', 'ASC'], ['assetId', 'ASC']] });
      const existingFindingEvaluationIds = new Set((await Finding.findAll({ where: { taskId: task.id } })).map((item) => item.evaluationId));
      const targetEvaluation = rows.find((item) => !existingFindingEvaluationIds.has(item.id));
      expect(targetEvaluation).toBeDefined();
      await targetEvaluation.update({ complianceStatus: 'compliant' });
      await expect(riskService.create({
        taskId: task.id,
        title: '不应生成的合规风险',
        description: '合规评估不能作为风险来源',
        riskLevel: 'low',
        ownerDepartmentId: department.id,
        ownerUserId: user.id,
        sources: [{ controlEvaluationId: targetEvaluation.id }],
        assets: [{ assetId: targetEvaluation.assetId }],
      }, requestUser, `compliant-source-${task.id}`)).rejects.toMatchObject({ code: 'NOT_FOUND' });

      await targetEvaluation.update({ complianceStatus: 'non_compliant' });
      const completed = await lifecycleService.completeReview(task.id, user.id);
      expect(completed.status).toBe('pending_closure');
      const finding = await Finding.create({
        code: `FND-TEST-${Date.now()}`,
        taskId: task.id,
        evaluationId: targetEvaluation.id,
        title: '待闭环不符合项',
        description: '用于验证评估关闭门禁',
        severity: 'medium',
        ownerDepartmentId: department.id,
        ownerUserId: user.id,
        createdBy: auditorUser.id,
      });
      await expect(lifecycleService.closeAssessment(task.id, user.id)).rejects.toThrow('尚未解决');
      const escalatedRisk = await riskService.createFromFindings({
        findingIds: [finding.id],
        title: '由不符合项升级的测试风险',
        description: '验证风险正式接受可驱动不符合项解决',
        riskLevel: 'medium',
        treatmentStrategy: 'accept',
        ownerDepartmentId: department.id,
        ownerUserId: user.id,
      }, requestUser, `finding-risk-${finding.id}`);
      const confirmedRisk = await riskService.confirm(escalatedRisk.id, requestUser, escalatedRisk.lockVersion);
      await riskService.accept(
        confirmedRisk.id,
        '测试环境正式接受并设置复查日期',
        new Date(Date.now() + 30 * 86400000),
        requestUser,
        confirmedRisk.lockVersion,
      );
      expect((await Finding.findByPk(finding.id)).status).toBe('resolved');
      const closed = await lifecycleService.closeAssessment(task.id, user.id);
      expect(closed.status).toBe('closed');
      expect(await RiskRecord.count({ where: { taskId: task.id } })).toBeGreaterThanOrEqual(2);
    });
  }, 30_000);

  test('assessment plan execution is idempotent and archived assets require attention', async () => {
    const { AssessmentPlan, Asset } = require('../src/models');
    const planService = require('../src/services/assessment-plan.service').default;
    await runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, async () => {
      const snapshot = matrixEntries;
      const plan = await AssessmentPlan.create({
        name: '月度关系图评估',
        templateId: template.id,
        assessmentType: 'ISO 27001',
        defaultDepartmentId: department.id,
        cronExpression: '0 9 1 * *',
        scopeSnapshot: assets.map((asset) => ({ assetId: asset.id })),
        matrixSnapshot: snapshot,
        enabled: true,
        createdBy: user.id,
      });
      const [first, repeated] = await Promise.all([
        planService.executeScheduled(plan.id, `test:${plan.id}:1`, 'jest'),
        planService.executeScheduled(plan.id, `test:${plan.id}:1`, 'jest-2'),
      ]);
      expect(repeated.id).toBe(first.id);
      expect(first.status).toBe('success');
      const generatedTask = await require('../src/models').AuditTask.findByPk(first.taskId);
      expect(generatedTask.publishedAt).toBeNull();
      expect(generatedTask.status).toBe('preparing');
      await Asset.update({ status: 'archived', archivedAt: new Date() }, { where: { id: assets[1].id } });
      const attention = await planService.executeScheduled(plan.id, `test:${plan.id}:2`, 'jest');
      expect(attention.status).toBe('requires_attention');
      expect(attention.taskId).toBeNull();
    });
  }, 30_000);
});
