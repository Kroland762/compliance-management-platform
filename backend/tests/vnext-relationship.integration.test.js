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
      DepartmentMember,
      MemberRole,
      QuestionTemplate,
      QuestionnaireTemplate,
      TenantMember,
      User,
      Role,
    } = require('../src/models');
    const taskService = require('../src/services/task.service').default;
    const scopeService = require('../src/services/assessment-scope.service').default;
    const memberContextService = require('../src/services/member-context.service').default;

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
      const auditorRole = await Role.findOne({ where: { systemKey: 'auditor' } });
      const auditorMember = await TenantMember.create({ userId: auditorUser.id, displayName: '关系图审计员一', status: 'active' });
      const auditorTwoMember = await TenantMember.create({ userId: auditorTwo.id, displayName: '关系图审计员二', status: 'active' });
      await MemberRole.bulkCreate([
        { memberId: auditorMember.id, roleId: auditorRole.id },
        { memberId: auditorTwoMember.id, roleId: auditorRole.id },
      ]);
      await DepartmentMember.bulkCreate([
        { memberId: auditorMember.id, departmentId: department.id, isPrimary: true },
        { memberId: auditorTwoMember.id, departmentId: department.id, isPrimary: true },
      ]);
      const memberContext = await memberContextService.resolve(user.id);
      requestUser = {
        userId: user.id,
        memberId: member.id,
        tenantId: tenant.id,
        roleIds: memberContext.roleIds,
        isGlobalAdmin: true,
        permissions: memberContext.permissions,
        permissionScopes: memberContext.permissionScopes,
        departmentIds: memberContext.departmentIds,
        primaryDepartmentId: memberContext.primaryDepartmentId,
      };
      requestAuditor = {
        userId: auditorUser.id,
        memberId: auditorMember.id,
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
      requestAuditorTwo = { ...requestAuditor, userId: auditorTwo.id, memberId: auditorTwoMember.id };
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
    require('../src/services/account/cronScheduler.service').default.shutdown();
    if (sequelize && suffix) {
      const { cleanupIntegrationState } = require('./helpers/tenant-cleanup');
      await cleanupIntegrationState({
        sequelize,
        tenants: [tenant],
        userIds: [user?.id, auditorUser?.id, auditorTwo?.id],
      });
    }
    if (sequelize) await sequelize.close();
  });

  async function createSourceFixture() {
    const { AssessmentAuditor, Finding, QuestionItem } = require('../src/models');
    const scopeService = require('../src/services/assessment-scope.service').default;
    const project = await require('../src/services/task.service').default.createTask({
      templateId: template.id, assessmentType: 'ISO 27001', name: '来源替换回归',
      assessmentTarget: '来源替换回归', departmentId: department.id, createdBy: user.id,
    });
    await AssessmentAuditor.create({ taskId: project.id, auditorUserId: auditorUser.id, assignedBy: user.id });
    await scopeService.replaceAssets(project.id, assets.map((asset) => asset.id), requestUser);
    await scopeService.replaceMatrix(project.id, matrixEntries, requestUser);
    await scopeService.publish(project.id, requestUser);
    await QuestionItem.update({ workflowStatus: 'reviewed', complianceStatus: 'non_compliant',
      reviewedBy: auditorUser.id, reviewedAt: new Date() }, { where: { taskId: project.id } });
    const rows = await QuestionItem.findAll({ where: { taskId: project.id }, order: [['id', 'ASC']] });
    const findings = [];
    for (const row of rows) findings.push(await Finding.create({
      code: `FR-${row.id.slice(0, 20)}`, taskId: project.id, evaluationId: row.id,
      title: '来源关系回归', description: '隔离项目的待处置不符合项', severity: 'medium',
      ownerDepartmentId: department.id, ownerUserId: user.id, createdBy: auditorUser.id,
    }));
    const createRisk = (indices, label) => require('../src/services/risk-domain.service').default.create({
      taskId: project.id, title: label, description: '来源同步集成回归', riskLevel: 'medium',
      ownerDepartmentId: department.id, ownerUserId: user.id,
      sources: indices.map((index) => ({ controlEvaluationId: rows[index].id })),
      assets: assets.map((asset) => ({ assetId: asset.id })),
    }, requestUser, `${project.id}-${label}`);
    return { project, rows, findings, createRisk };
  }

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
      expect((await AuditTask.findByPk(sheetTask.id)).columnSchemaSnapshot.map((column) => column.key)).toEqual([
        'sequenceNumber', 'controlPoint', 'assets', 'assignee', 'answer', 'evidence', 'history',
        'compliance', 'findingDescription', 'findingSeverity', 'status', 'actions',
      ]);
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
      }, requestUser, finding.lockVersion, `finding-remediate-${finding.id}`);
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
      Finding,
      Notification,
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
      // Use fresh findings; earlier cases deliberately resolved findings in the main project.
      const { rows: sourceRows } = await createSourceFixture();
      const firstInput = {
        taskId: sourceRows[0].taskId,
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
        taskId: sourceRows[0].taskId,
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
      const submittedNotificationCount = await Notification.count({
        where: { userId: auditorUser.id, notificationType: 'remediation_submitted' },
      });
      const submitted = await remediationService.submit(
        action.id,
        requestUser,
        actionWithProgress.lockVersion,
        `submit-${action.id}`,
      );
      expect(await Notification.count({
        where: { userId: auditorUser.id, notificationType: 'remediation_submitted' },
      })).toBe(submittedNotificationCount + 1);
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
      const secondClosable = await RiskRecord.findByPk(second.id);
      await riskService.close(second.id, '验证第二个风险关闭门禁', requestAuditor, secondClosable.lockVersion);
      expect((await RiskRecord.findByPk(first.id)).status).toBe(RiskLifecycleStatus.CLOSED);
      expect((await riskService.detail(first.id, requestUser)).sources).toHaveLength(2);
      expect((await riskService.detail(first.id, requestUser)).affectedAssets).toHaveLength(3);
    });
  }, 30_000);

  test('independent daily-operations risk completes confirmation, remediation, verification, export and close', async () => {
    const ExcelJS = require('exceljs');
    const { AuditLog, EvidenceFile, Notification, RemediationAction, RiskRecord } = require('../src/models');
    const exportService = require('../src/services/export.service').default;
    const remediationService = require('../src/services/remediation.service').default;
    const riskService = require('../src/services/risk-domain.service').default;
    const workItemService = require('../src/services/work-item.service').default;
    await runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, async () => {
      const input = {
        title: '日常运维访问权限风险',
        description: '运维工单复查发现共享账号权限过大',
        discoverySource: 'daily_operations',
        discoverySourceDetail: '月度运维工单抽查发现共享账号未按期收敛',
        sourceReference: 'OPS-INTEGRATION-001',
        reviewerUserId: auditorUser.id,
        riskLevel: 'high',
        treatmentStrategy: 'mitigate',
        ownerDepartmentId: department.id,
        ownerUserId: user.id,
        dueDate: new Date(Date.now() + 7 * 86400000),
        assets: [{ assetId: assets[0].id, impactLevel: 'high', impactDescription: '影响核心应用访问控制' }],
      };
      let created = await riskService.create(input, requestUser, `manual-risk-${suffix}`);
      expect(created).toMatchObject({ taskId: null, creationMode: 'manual', discoverySource: 'daily_operations' });
      expect(created.sources).toHaveLength(0);
      expect(created.reviewer.displayName).toBe('关系图审计员一');
      expect(await Notification.count({
        where: { userId: user.id, notificationType: 'risk_assigned', taskId: null },
      })).toBeGreaterThan(0);
      const originalLockVersion = created.lockVersion;
      created = await riskService.update(created.id, {
        discoverySourceDetail: '月度运维工单抽查确认共享账号仍未按期收敛',
        sourceReference: 'OPS-INTEGRATION-001-UPDATED',
      }, requestUser, created.lockVersion);
      expect(created.sourceReference).toBe('OPS-INTEGRATION-001-UPDATED');
      await expect(riskService.update(created.id, { title: '过期版本不得覆盖' }, requestUser, originalLockVersion))
        .rejects.toMatchObject({ code: 'CONFLICT' });
      created = await riskService.assignReviewer(created.id, auditorTwo.id, requestUser, created.lockVersion);
      expect(created.reviewer.displayName).toBe('关系图审计员二');
      created = await riskService.assignReviewer(created.id, auditorUser.id, requestUser, created.lockVersion);
      expect((await riskService.list({ taskId: task.id }, requestUser)).items.map((item) => item.id)).not.toContain(created.id);
      expect((await workItemService.list(requestAuditor)).riskConfirm.map((item) => item.id)).toContain(created.id);
      expect(await Notification.count({ where: { userId: auditorUser.id, notificationType: 'risk_pending_confirmation' } })).toBeGreaterThan(0);

      const confirmed = await riskService.confirm(created.id, requestAuditor, created.lockVersion);
      expect(confirmed.status).toBe('open');
      const action = await remediationService.create({
        title: '收敛共享账号权限', description: '替换共享账号并回收多余权限',
        ownerUserId: user.id, ownerDepartmentId: department.id,
        dueDate: new Date(Date.now() + 3 * 86400000),
        riskLinks: [{ riskId: created.id, contributionDescription: '消除共享账号造成的越权风险' }],
      }, requestUser);
      const progressed = await remediationService.update(action.id, { progressNote: '账号已替换，权限复核完成' }, requestUser, action.lockVersion);
      await EvidenceFile.create({
        questionItemId: null, remediationActionId: action.id,
        originalFilename: 'manual-risk-remediation.txt', storedFilename: null, filePath: null,
        storageKey: `tenants/${tenant.id}/test/manual-risk-remediation.txt`, sha256: 'c'.repeat(64),
        status: 'active', deletedAt: null, evidenceType: 'remediation', evidencePurpose: 'remediation',
        fileSize: 1, mimeType: 'text/plain', uploadedBy: user.id,
      });
      const submitted = await remediationService.submit(action.id, requestUser, progressed.lockVersion, `manual-submit-${suffix}`);
      expect((await workItemService.list(requestAuditor)).verify.map((item) => item.id)).toContain(action.id);
      await expect(remediationService.verify(created.id, action.id, { decision: 'approved' }, requestUser, submitted.lockVersion))
        .rejects.toMatchObject({ code: 'SELF_REVIEW_FORBIDDEN' });
      const rejected = await remediationService.verify(created.id, action.id, {
        decision: 'rejected', comment: '请补充共享账号禁用证明',
      }, requestAuditor, submitted.lockVersion);
      expect((await RemediationAction.findByPk(action.id)).status).toBe('in_progress');
      expect(await Notification.count({
        where: { userId: user.id, notificationType: 'remediation_rejected', taskId: null },
      })).toBeGreaterThan(0);
      const resubmissionReady = await remediationService.update(action.id, {
        progressNote: '共享账号已禁用，并完成二次权限复核',
      }, requestUser, rejected.lockVersion);
      const resubmitted = await remediationService.submit(
        action.id,
        requestUser,
        resubmissionReady.lockVersion,
        `manual-resubmit-${suffix}`,
      );
      const verified = await remediationService.verify(created.id, action.id, {
        decision: 'approved', comment: '独立验证通过',
      }, requestAuditor, resubmitted.lockVersion);
      expect((await RemediationAction.findByPk(action.id)).status).toBe('completed');
      const closable = await RiskRecord.findByPk(created.id);
      await riskService.close(created.id, '独立风险闭环完成', requestAuditor, closable.lockVersion);
      expect((await RiskRecord.findByPk(created.id)).status).toBe('closed');

      const buffer = await exportService.exportRisks({ discoverySource: 'daily_operations' }, { id: created.id }, { tenantName: '关系图集成租户', exportedBy: 'integration' });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const sourceSheet = workbook.getWorksheet('来源');
      const sourceRows = sourceSheet.getRows(2, sourceSheet.rowCount - 1).map((row) => row.values);
      expect(sourceRows.some((row) => row[1] === created.code && row[2] === 'daily_operations' && row[3] === created.discoverySourceDetail)).toBe(true);
      expect(await AuditLog.count({ where: { resourceType: 'risk', resourceId: created.id } })).toBeGreaterThanOrEqual(3);
      expect(verified.id).toBe(action.id);
    });
  }, 30_000);

  test.each(['accept', 'close'])('replacing source A with B makes %s resolve only B', async (outcome) => {
    const { AuditLog, EvidenceFile, Finding, OperationType, RiskFindingLink, RiskRecord, RiskSource } = require('../src/models');
    const riskService = require('../src/services/risk-domain.service').default;
    const remediationService = require('../src/services/remediation.service').default;
    await runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, async () => {
      const { rows, findings, createRisk } = await createSourceFixture();
      const original = await createRisk([0], `替换后${outcome}`);
      const versionA = (await Finding.findByPk(findings[0].id)).lockVersion;
      const replaced = await riskService.replaceSources(original.id, [{
        controlEvaluationId: rows[1].id, relationType: 'primary', rationale: '以复核后的来源 B 替代 A',
      }], requestUser, original.lockVersion);
      expect(replaced.lockVersion).toBe(original.lockVersion + 1);
      expect((await Finding.findByPk(findings[0].id)).toJSON()).toMatchObject({
        status: 'open', disposition: 'pending', lockVersion: versionA + 1,
      });
      expect((await Finding.findByPk(findings[1].id)).toJSON()).toMatchObject({ status: 'escalated', disposition: 'risk' });
      expect((await RiskSource.findOne({ where: { riskId: original.id } })).toJSON()).toMatchObject({
        controlEvaluationId: rows[1].id, relationType: 'primary', rationale: '以复核后的来源 B 替代 A',
      });
      expect((await RiskFindingLink.findOne({ where: { riskId: original.id } })).toJSON()).toMatchObject({
        findingId: findings[1].id, relationType: 'primary', rationale: '以复核后的来源 B 替代 A',
      });
      expect(await AuditLog.count({ where: { resourceId: original.id, operationType: OperationType.UPDATE } })).toBeGreaterThan(0);
      const confirmed = await riskService.confirm(original.id, requestUser, replaced.lockVersion);
      if (outcome === 'accept') {
        await riskService.accept(original.id, '正式接受替换后的风险', new Date(Date.now() + 86400000), requestUser, confirmed.lockVersion);
      } else {
        const action = await remediationService.create({
          title: '来源替换后的整改', description: '仅验证新来源 B', ownerUserId: user.id,
          ownerDepartmentId: department.id, dueDate: new Date(Date.now() + 86400000),
          riskLinks: [{ riskId: original.id, contributionDescription: '整改新来源' }],
        }, requestUser);
        const progressed = await remediationService.update(action.id, { progressNote: '整改已实施并复核' }, requestUser, action.lockVersion);
        await EvidenceFile.create({
          questionItemId: null, remediationActionId: action.id, originalFilename: 'source-replacement.txt',
          storageKey: `tenants/${tenant.id}/test/${action.id}.txt`, sha256: 'd'.repeat(64),
          status: 'active', evidenceType: 'remediation', evidencePurpose: 'remediation',
          fileSize: 1, mimeType: 'text/plain', uploadedBy: user.id,
        });
        const submitted = await remediationService.submit(action.id, requestUser, progressed.lockVersion, `replacement-${action.id}`);
        await remediationService.verify(original.id, action.id, { decision: 'approved', comment: '新来源整改通过' }, requestAuditor, submitted.lockVersion);
        const ready = await RiskRecord.findByPk(original.id);
        await riskService.close(original.id, '关闭替换后的风险', requestAuditor, ready.lockVersion);
      }
      expect((await Finding.findByPk(findings[1].id)).status).toBe('resolved');
      expect((await Finding.findByPk(findings[0].id)).toJSON()).toMatchObject({ status: 'open', disposition: 'pending', resolvedAt: null });
    });
  }, 30_000);

  test('partial replacement preserves retained and other-risk links, and rolls back all writes on failure', async () => {
    const { Finding, RiskFindingLink, RiskRecord, RiskSource } = require('../src/models');
    const riskService = require('../src/services/risk-domain.service').default;
    const auditLogService = require('../src/services/audit-log.service').default;
    await runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, async () => {
      const { rows, findings, createRisk } = await createSourceFixture();
      const original = await createRisk([0, 1], '部分替换');
      const other = await createRisk([3], '保留旧来源的另一个风险');
      // A legacy many-to-many association must survive replacement in the first risk.
      await RiskFindingLink.create({ riskId: other.id, findingId: findings[0].id, createdBy: user.id });
      await RiskSource.create({ riskId: other.id, controlEvaluationId: rows[0].id, createdBy: user.id });
      const selected = [{ controlEvaluationId: rows[1].id, rationale: '保留 B' },
        { controlEvaluationId: rows[2].id, relationType: 'supporting', rationale: '新增 C' }];
      const originalSources = (await RiskSource.findAll({ where: { riskId: original.id } })).map((row) => row.toJSON());
      const originalLinks = (await RiskFindingLink.findAll({ where: { riskId: original.id } })).map((row) => row.toJSON());
      const originalFindings = (await Finding.findAll({ where: { taskId: rows[0].taskId }, order: [['id', 'ASC']] })).map((row) => row.toJSON());
      const loggingFailure = jest.spyOn(auditLogService, 'log').mockRejectedValueOnce(new Error('forced audit write failure'));
      try {
        await expect(riskService.replaceSources(original.id, selected, requestUser, original.lockVersion)).rejects.toThrow('forced audit write failure');
      } finally { loggingFailure.mockRestore(); }
      expect((await RiskRecord.findByPk(original.id)).lockVersion).toBe(original.lockVersion);
      expect((await RiskSource.findAll({ where: { riskId: original.id } })).map((row) => row.toJSON())).toEqual(originalSources);
      expect((await RiskFindingLink.findAll({ where: { riskId: original.id } })).map((row) => row.toJSON())).toEqual(originalLinks);
      expect((await Finding.findAll({ where: { taskId: rows[0].taskId }, order: [['id', 'ASC']] })).map((row) => row.toJSON())).toEqual(originalFindings);
      const replaced = await riskService.replaceSources(original.id, selected, requestUser, original.lockVersion);
      for (const finding of findings.slice(0, 3)) {
        const previous = originalFindings.find((row) => row.id === finding.id);
        expect((await Finding.findByPk(finding.id)).lockVersion).toBe(previous.lockVersion + 1);
      }
      expect((await Finding.findByPk(findings[0].id)).toJSON()).toMatchObject({ status: 'escalated', disposition: 'risk' });
      expect(await RiskFindingLink.count({ where: { riskId: other.id, findingId: findings[0].id } })).toBe(1);
      expect((await RiskFindingLink.findAll({ where: { riskId: original.id } })).map((row) => row.findingId).sort())
        .toEqual([findings[1].id, findings[2].id].sort());
      await expect(riskService.replaceSources(original.id, selected, requestUser, original.lockVersion)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await RiskRecord.findByPk(original.id)).lockVersion).toBe(replaced.lockVersion);
      const retainedVersions = await Promise.all(findings.slice(1, 3).map(async (finding) => (await Finding.findByPk(finding.id)).lockVersion));
      await riskService.replaceSources(original.id, selected, requestUser, replaced.lockVersion);
      expect(await Promise.all(findings.slice(1, 3).map(async (finding) => (await Finding.findByPk(finding.id)).lockVersion)))
        .toEqual(retainedVersions);
    });
  }, 30_000);

  test('source gates reject missing, directly remediating, resolved and inconsistent finding relationships', async () => {
    const { Finding, RiskFindingLink, RiskRecord, RiskSource } = require('../src/models');
    const riskService = require('../src/services/risk-domain.service').default;
    await runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, async () => {
      const { rows, findings, createRisk } = await createSourceFixture();
      const risk = await createRisk([0], '拒绝无效来源');
      await findings[1].update({ status: 'remediating', disposition: 'direct_remediation' });
      await findings[2].update({ status: 'resolved', disposition: 'risk', resolvedBy: auditorUser.id, resolvedAt: new Date() });
      await findings[3].destroy();
      for (const row of rows.slice(1)) {
        await expect(riskService.replaceSources(risk.id, [{ controlEvaluationId: row.id }], requestUser, risk.lockVersion))
          .rejects.toMatchObject({ code: 'CONFLICT' });
        expect((await RiskRecord.findByPk(risk.id)).lockVersion).toBe(risk.lockVersion);
        expect((await RiskSource.findOne({ where: { riskId: risk.id } })).controlEvaluationId).toBe(rows[0].id);
      }
      // Reproduce historical mismatched relations with equal source/link cardinality.
      await RiskFindingLink.update({ findingId: findings[2].id }, { where: { riskId: risk.id } });
      await expect(riskService.confirm(risk.id, requestUser, risk.lockVersion)).rejects.toMatchObject({ code: 'CONFIRM_GATE_FAILED' });
      expect((await RiskRecord.findByPk(risk.id)).status).toBe('pending_confirmation');
      expect((await Finding.findByPk(findings[2].id)).status).toBe('resolved');
    });
  }, 30_000);

  test('reviewer eligibility merges persisted roles and rechecks permissions after creation', async () => {
    const { MemberRole, Role, TenantMember, RiskRecord } = require('../src/models');
    const eligibility = require('../src/services/risk-reviewer-eligibility.service').default;
    const riskService = require('../src/services/risk-domain.service').default;
    const lookup = require('../src/services/lookup.service').default;
    await runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, async () => {
      const member = await TenantMember.findOne({ where: { userId: auditorTwo.id } });
      const saved = await MemberRole.findAll({ where: { memberId: member.id } });
      const readRole = await Role.create({ tenantId: tenant.id, name: '来源回归读取角色', permissions: {
        risks: ['read'], remediation_actions: ['read'],
      } });
      const workflowRole = await Role.create({ tenantId: tenant.id, name: '来源回归审核角色', permissions: { risks: ['confirm'] } });
      await MemberRole.destroy({ where: { memberId: member.id } });
      await MemberRole.bulkCreate([{ memberId: member.id, roleId: readRole.id }, { memberId: member.id, roleId: workflowRole.id }]);
      const input = { title: '审核权限变更回归', description: '验证创建后撤销审核人权限', discoverySource: 'daily_operations',
        discoverySourceDetail: '测试审核人完整权限', reviewerUserId: auditorTwo.id, riskLevel: 'medium',
        ownerDepartmentId: department.id, ownerUserId: user.id, assets: [{ assetId: assets[0].id }] };
      try {
        for (const permissions of [{ risks: ['confirm'] }, { risks: ['verify'] }]) {
          await workflowRole.update({ permissions });
          await expect(eligibility.assertEligible(auditorTwo.id)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
          await expect(riskService.create(input, requestUser, `${workflowRole.id}-${JSON.stringify(permissions)}`))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
          const candidates = await lookup.list('personnel', { purpose: 'risk-reviewer' }, requestUser);
          expect(candidates.items.map((item) => item.value)).not.toContain(auditorTwo.id);
        }
        for (const permissions of [{ risks: ['confirm', 'verify'] }, { risks: ['confirm'], remediation_actions: ['verify'] }]) {
          await workflowRole.update({ permissions });
          await expect(eligibility.assertEligible(auditorTwo.id)).resolves.toBeUndefined();
          const candidates = await lookup.list('personnel', { purpose: 'risk-reviewer' }, requestUser);
          expect(candidates.items.map((item) => item.value)).toContain(auditorTwo.id);
        }
        const created = await riskService.create(input, requestUser, `${workflowRole.id}-valid`);
        await workflowRole.update({ permissions: { risks: ['confirm'] } });
        await expect(riskService.confirm(created.id, requestUser, created.lockVersion)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(riskService.assignReviewer(created.id, auditorTwo.id, requestUser, created.lockVersion)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        expect((await RiskRecord.findByPk(created.id)).toJSON()).toMatchObject({ status: 'pending_confirmation', lockVersion: created.lockVersion });
      } finally {
        await MemberRole.destroy({ where: { memberId: member.id } });
        await MemberRole.bulkCreate(saved.map((row) => ({ memberId: member.id, roleId: row.roleId })));
        await workflowRole.destroy();
        await readRole.destroy();
      }
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
      expect(await RiskRecord.count({ where: { taskId: task.id } })).toBeGreaterThanOrEqual(1);
    });
  }, 30_000);

  test('assessment plan execution is idempotent and archived assets require attention', async () => {
    const { AssessmentPlan, AssessmentPlanExecution, Asset } = require('../src/models');
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
      const completedExecution = await AssessmentPlanExecution.findByPk(first.id);
      expect(completedExecution.status).toBe('success');
      const generatedTask = await require('../src/models').AuditTask.findByPk(completedExecution.taskId);
      expect(generatedTask.publishedAt).toBeNull();
      expect(generatedTask.status).toBe('preparing');
      await Asset.update({ status: 'archived', archivedAt: new Date() }, { where: { id: assets[1].id } });
      const attention = await planService.executeScheduled(plan.id, `test:${plan.id}:2`, 'jest');
      expect(attention.status).toBe('requires_attention');
      expect(attention.taskId).toBeNull();
    });
  }, 30_000);
});
