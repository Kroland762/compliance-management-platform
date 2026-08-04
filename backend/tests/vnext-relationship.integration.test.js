const runIntegration = process.env.RUN_PG_INTEGRATION === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('vNext assessment, risk and remediation relationship graph', () => {
  let sequelize;
  let runWithTenantContext;
  let tenant;
  let user;
  let department;
  let requestUser;
  let template;
  let controls;
  let assets;
  let task;
  let evaluations;
  let matrixEntries;

  beforeAll(async () => {
    sequelize = require('../src/config/database').default;
    const { setupAssociations } = require('../src/models/associations');
    setupAssociations();
    const { migrateUp } = require('../src/config/migrations/runner');
    const provisioning = require('../src/services/tenant-provisioning.service').default;
    runWithTenantContext = require('../src/middlewares/tenant').runWithTenantContext;
    const {
      Asset,
      Department,
      QuestionTemplate,
      QuestionnaireTemplate,
      TenantMember,
      User,
    } = require('../src/models');
    const taskService = require('../src/services/task.service').default;
    const scopeService = require('../src/services/assessment-scope.service').default;

    await migrateUp();
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const result = await provisioning.provision({
      name: '关系图集成租户',
      slug: `graph_${suffix}`,
      admin: { username: `graph_admin_${suffix}`, displayName: '关系图管理员' },
    });
    tenant = result.tenant;
    user = await User.findOne({ where: { username: `graph_admin_${suffix}` } });

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
      template = await QuestionnaireTemplate.create({
        name: '关系图标准',
        description: null,
        createdBy: user.id,
        questionCount: 2,
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
        requestUser,
        submitted.lockVersion,
      );
      expect((await RemediationAction.findByPk(action.id)).status).toBe('pending_verification');
      await remediationService.verify(
        second.id,
        action.id,
        { decision: 'approved', comment: '风险二通过' },
        requestUser,
        afterFirstVerification.lockVersion,
      );
      expect((await RemediationAction.findByPk(action.id)).status).toBe('completed');
      expect(await RiskActionLink.count({ where: { actionId: action.id, verificationStatus: 'approved' } })).toBe(2);
      const closable = await RiskRecord.findByPk(first.id);
      await riskService.close(first.id, '验证关闭门禁', requestUser, closable.lockVersion);
      expect((await RiskRecord.findByPk(first.id)).status).toBe(RiskLifecycleStatus.CLOSED);
      expect((await riskService.detail(first.id, requestUser)).sources).toHaveLength(2);
      expect((await riskService.detail(first.id, requestUser)).affectedAssets).toHaveLength(3);
    });
  }, 30_000);

  test('only unfavorable reviewed evaluations can create risks and task completion waits for all risk mappings', async () => {
    const {
      AuditTask,
      QuestionItem,
      RiskRecord,
    } = require('../src/models');
    const riskService = require('../src/services/risk-domain.service').default;
    const lifecycleService = require('../src/services/task-lifecycle.service').default;
    await runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, async () => {
      const rows = await QuestionItem.findAll({ where: { taskId: task.id }, order: [['sequenceNumber', 'ASC'], ['assetId', 'ASC']] });
      await rows[3].update({ complianceStatus: 'compliant' });
      await expect(riskService.create({
        taskId: task.id,
        title: '不应生成的合规风险',
        description: '合规评估不能作为风险来源',
        riskLevel: 'low',
        ownerDepartmentId: department.id,
        ownerUserId: user.id,
        sources: [{ controlEvaluationId: rows[3].id }],
        assets: [{ assetId: rows[3].assetId }],
      }, requestUser, `compliant-source-${task.id}`)).rejects.toMatchObject({ code: 'NOT_FOUND' });

      await rows[3].update({ complianceStatus: 'non_compliant' });
      await AuditTask.update({ status: 'under_review' }, { where: { id: task.id } });
      await expect(lifecycleService.completeReview(task.id, user.id))
        .rejects.toThrow('尚未生成风险');
      expect((await AuditTask.findByPk(task.id)).status).toBe('under_review');

      await riskService.create({
        taskId: task.id,
        title: '剩余控制项风险',
        description: '补齐最后一个风险来源后才能完成评估',
        riskLevel: 'medium',
        ownerDepartmentId: department.id,
        ownerUserId: user.id,
        sources: [{ controlEvaluationId: rows[3].id }],
        assets: [{ assetId: rows[3].assetId }],
      }, requestUser, `last-source-${task.id}`);
      const completed = await lifecycleService.completeReview(task.id, user.id);
      expect(completed.status).toBe('completed');
      expect(await RiskRecord.count({ where: { taskId: task.id } })).toBeGreaterThanOrEqual(3);
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
      expect(generatedTask.status).toBe('configuring');
      await Asset.update({ status: 'archived', archivedAt: new Date() }, { where: { id: assets[1].id } });
      const attention = await planService.executeScheduled(plan.id, `test:${plan.id}:2`, 'jest');
      expect(attention.status).toBe('requires_attention');
      expect(attention.taskId).toBeNull();
    });
  }, 30_000);
});
