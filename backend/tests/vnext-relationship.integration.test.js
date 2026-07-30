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
      await scopeService.replaceMatrix(task.id, controls.flatMap((control) => assets.map((asset) => ({
        controlPointId: control.id,
        assetId: asset.id,
        assignedTo: user.id,
        responsibleDepartmentId: department.id,
      }))), requestUser);
      await scopeService.publish(task.id, requestUser);
      evaluations = await require('../src/models').QuestionItem.findAll({ where: { taskId: task.id } });
    });
  }, 90_000);

  afterAll(async () => {
    await sequelize.close();
  });

  test('publishing a 2 x 2 matrix creates four stable, unique evaluations and is idempotent', async () => {
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
      const first = await riskService.create({
        taskId: task.id,
        title: '共享身份权限风险',
        description: '多个控制项共同形成风险',
        riskLevel: 'high',
        ownerDepartmentId: department.id,
        ownerUserId: user.id,
        sources: sourceRows.slice(0, 2).map((item) => ({ controlEvaluationId: item.id })),
        assets: assets.map((asset) => ({ assetId: asset.id })),
      }, requestUser);
      const second = await riskService.create({
        taskId: task.id,
        title: '数据库权限风险',
        description: '单个控制项影响数据库资产',
        riskLevel: 'medium',
        ownerDepartmentId: department.id,
        ownerUserId: user.id,
        sources: [{ controlEvaluationId: sourceRows[2].id }],
        assets: [{ assetId: assets[1].id }],
      }, requestUser);
      await riskService.confirm(first.id, requestUser);
      await riskService.confirm(second.id, requestUser);
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
      await remediationService.submit(action.id, requestUser);
      await remediationService.verify(first.id, action.id, { decision: 'approved', comment: '风险一通过' }, requestUser);
      expect((await RemediationAction.findByPk(action.id)).status).toBe('pending_verification');
      await remediationService.verify(second.id, action.id, { decision: 'approved', comment: '风险二通过' }, requestUser);
      expect((await RemediationAction.findByPk(action.id)).status).toBe('completed');
      expect(await RiskActionLink.count({ where: { actionId: action.id, verificationStatus: 'approved' } })).toBe(2);
      await riskService.close(first.id, '验证关闭门禁', requestUser);
      expect((await RiskRecord.findByPk(first.id)).status).toBe(RiskLifecycleStatus.CLOSED);
      expect((await riskService.detail(first.id, requestUser)).sources).toHaveLength(2);
      expect((await riskService.detail(first.id, requestUser)).affectedAssets).toHaveLength(2);
    });
  }, 30_000);

  test('assessment plan execution is idempotent and archived assets require attention', async () => {
    const { AssessmentPlan, Asset } = require('../src/models');
    const planService = require('../src/services/assessment-plan.service').default;
    await runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, async () => {
      const snapshot = controls.flatMap((control) => assets.map((asset) => ({
        controlPointId: control.id,
        assetId: asset.id,
        assignedTo: user.id,
        responsibleDepartmentId: department.id,
      })));
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
      const first = await planService.executeScheduled(plan.id, `test:${plan.id}:1`, 'jest');
      const repeated = await planService.executeScheduled(plan.id, `test:${plan.id}:1`, 'jest-2');
      expect(repeated.id).toBe(first.id);
      expect(first.status).toBe('success');
      await Asset.update({ status: 'archived', archivedAt: new Date() }, { where: { id: assets[1].id } });
      const attention = await planService.executeScheduled(plan.id, `test:${plan.id}:2`, 'jest');
      expect(attention.status).toBe('requires_attention');
      expect(attention.taskId).toBeNull();
    });
  }, 30_000);
});
