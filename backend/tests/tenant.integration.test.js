const runIntegration = process.env.RUN_PG_INTEGRATION === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('PostgreSQL tenant isolation and context API', () => {
  let sequelize;
  let app;
  let request;
  let jwt;
  let tenantA;
  let tenantB;
  let globalToken;
  let tenantToken;
  let tenantUser;
  let tenantUsername;
  const tenantPassword = 'TenantLogin1234!';
  let tenantBQualificationId;
  let tenantBTaskId;

  beforeAll(async () => {
    const supertest = require('supertest');
    jwt = require('jsonwebtoken');
    sequelize = require('../src/config/database').default;
    app = require('../src/index').createApp();
    request = supertest(app);
    const { migrateUp } = require('../src/config/migrations/runner');
    const {
      RoleTemplate, Role, User, UserRole, Qualification, Department,
      QuestionnaireTemplate, AuditTask, AssessmentType, TaskStatus,
    } = require('../src/models');
    const provisioning = require('../src/services/tenant-provisioning.service').default;
    const { runWithTenantContext } = require('../src/middlewares/tenant');

    await migrateUp();
    const adminPermissions = {
      tenants: ['create', 'read', 'update', 'delete'],
      users: ['create', 'read', 'update', 'delete'],
      dashboard: ['read'],
      qualifications: ['create', 'read', 'update', 'delete'],
      tasks: ['create', 'read', 'update', 'delete'],
      risks: ['read', 'update'],
      settings: ['read', 'update'],
      audit_logs: ['read'],
    };
    const [template] = await RoleTemplate.findOrCreate({
      where: { name: '集成测试超管' },
      defaults: { name: '集成测试超管', permissions: adminPermissions, isSystem: true },
    });
    await template.update({ permissions: adminPermissions });

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    tenantA = await provisioning.provision({ name: '租户甲', slug: `a_${suffix}` });
    tenantB = await provisioning.provision({ name: '租户乙', slug: `b_${suffix}` });

    const [globalUser] = await User.findOrCreate({
      where: { username: `global_${suffix}` },
      defaults: {
        username: `global_${suffix}`,
        passwordHash: 'not-used',
        role: UserRole.ADMINISTRATOR,
        roleId: template.id,
        tenantId: null,
        isActive: true,
      },
    });
    globalToken = jwt.sign({
      userId: globalUser.id,
      username: globalUser.username,
      role: template.name,
      roleId: template.id,
      tokenVersion: globalUser.tokenVersion,
    }, process.env.JWT_SECRET || 'dev-secret-do-not-use-in-prod', { expiresIn: 600 });

    let tenantRole;
    await runWithTenantContext({ schema: tenantA.schemaName, tenantId: tenantA.id }, async () => {
      tenantRole = await Role.findOne({ where: { tenantId: tenantA.id, name: '集成测试超管' } });
      await Qualification.create({ name: '同名资质', category: '企业资质' });
      await Department.create({ name: '同名部门' });
      const templateA = await QuestionnaireTemplate.create({
        name: '同名模板',
        description: null,
        createdBy: globalUser.id,
      });
      await AuditTask.create({
        templateId: templateA.id,
        assessmentType: AssessmentType.ISO27001,
        assessmentTarget: '同名任务',
        createdBy: globalUser.id,
        status: TaskStatus.DRAFT,
      });
    });
    await runWithTenantContext({ schema: tenantB.schemaName, tenantId: tenantB.id }, async () => {
      const row = await Qualification.create({ name: '同名资质', category: '企业资质' });
      tenantBQualificationId = row.id;
      await Department.create({ name: '同名部门' });
      const templateB = await QuestionnaireTemplate.create({
        name: '同名模板',
        description: null,
        createdBy: globalUser.id,
      });
      const taskB = await AuditTask.create({
        templateId: templateB.id,
        assessmentType: AssessmentType.ISO27001,
        assessmentTarget: '同名任务',
        createdBy: globalUser.id,
        status: TaskStatus.DRAFT,
      });
      tenantBTaskId = taskB.id;
    });
    const bcrypt = require('bcrypt');
    tenantUsername = `tenant_${suffix}`;
    tenantUser = await User.create({
      username: tenantUsername,
      passwordHash: await bcrypt.hash(tenantPassword, 6),
      role: UserRole.ADMINISTRATOR,
      roleId: tenantRole.id,
      tenantId: tenantA.id,
      isActive: true,
    });
    tenantToken = jwt.sign({
      userId: tenantUser.id,
      username: tenantUser.username,
      role: tenantRole.name,
      roleId: tenantRole.id,
      tenantId: tenantA.id,
      tokenVersion: tenantUser.tokenVersion,
    }, process.env.JWT_SECRET || 'dev-secret-do-not-use-in-prod', { expiresIn: 600 });
  }, 60_000);

  afterAll(async () => {
    await sequelize.close();
  });

  test('global administrator must explicitly select a tenant for business APIs', async () => {
    const denied = await request.get('/api/stats').set('Authorization', `Bearer ${globalToken}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('TENANT_CONTEXT_REQUIRED');

    const allowed = await request.get('/api/qualifications')
      .set('Authorization', `Bearer ${globalToken}`)
      .set('X-Tenant-ID', tenantA.id);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.pagination.total).toBe(1);
    expect(allowed.body.data.items[0].name).toBe('同名资质');

    const taskList = await request.get('/api/tasks?page=1&pageSize=20')
      .set('Authorization', `Bearer ${globalToken}`)
      .set('X-Tenant-ID', tenantA.id);
    expect(taskList.status).toBe(200);
    expect(taskList.body.data.pagination.total).toBe(1);
    expect(taskList.body.data.items[0].assessmentTarget).toBe('同名任务');
  });

  test('tenant users cannot forge X-Tenant-ID', async () => {
    const response = await request.get('/api/qualifications')
      .set('Authorization', `Bearer ${tenantToken}`)
      .set('X-Tenant-ID', tenantB.id);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  test('security settings, tenant entry, login and logout create tenant audit logs', async () => {
    const contextResponse = await request.post(`/api/tenants/${tenantA.id}/context`)
      .set('Authorization', `Bearer ${globalToken}`);
    expect(contextResponse.status).toBe(200);

    const settingsResponse = await request.put('/api/settings/security')
      .set('Authorization', `Bearer ${globalToken}`)
      .set('X-Tenant-ID', tenantA.id)
      .send({
        maxLoginAttempts: 6,
        lockDurationMinutes: 30,
        idleTimeoutMinutes: 60,
        auditLogRetentionDays: 180,
      });
    expect(settingsResponse.status).toBe(200);

    const captchaService = require('../src/services/captcha.service').default;
    const captcha = jest.spyOn(captchaService, 'verify').mockReturnValueOnce(true);
    const loginResponse = await request.post('/api/auth/login').send({
      username: tenantUsername,
      password: tenantPassword,
      captchaId: 'integration-captcha',
      captchaCode: 'abcd',
    });
    captcha.mockRestore();
    expect(loginResponse.status).toBe(200);

    const logoutResponse = await request.post('/api/auth/logout')
      .set('Authorization', `Bearer ${loginResponse.body.data.token}`);
    expect(logoutResponse.status).toBe(200);

    const { AuditLog, OperationType } = require('../src/models');
    const { runWithTenantContext } = require('../src/middlewares/tenant');
    const logs = await runWithTenantContext(
      { schema: tenantA.schemaName, tenantId: tenantA.id },
      () => AuditLog.findAll({
        where: {
          operationType: [
            OperationType.LOGIN,
            OperationType.LOGOUT,
            OperationType.UPDATE,
          ],
        },
        order: [['createdAt', 'ASC']],
      }),
    );
    const events = logs.map((log) => ({
      operationType: log.operationType,
      resourceType: log.resourceType,
      details: log.operationDetails || '',
      userId: log.userId,
    }));

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operationType: OperationType.LOGIN,
        resourceType: 'session',
        userId: tenantUser.id,
      }),
      expect.objectContaining({
        operationType: OperationType.LOGOUT,
        resourceType: 'session',
        userId: tenantUser.id,
      }),
      expect.objectContaining({
        operationType: OperationType.UPDATE,
        resourceType: 'security_settings',
      }),
    ]));
    expect(events.some((event) => event.details.includes('进入租户上下文'))).toBe(true);
    expect(JSON.stringify(events)).not.toContain(tenantPassword);
    expect(JSON.stringify(events)).not.toContain('integration-captcha');
    expect(JSON.stringify(events)).not.toContain('abcd');
  });

  test('cross-tenant object IDs return 404 and 45 rows paginate 20/20/5', async () => {
    const { Qualification } = require('../src/models');
    const { runWithTenantContext } = require('../src/middlewares/tenant');
    await runWithTenantContext({ schema: tenantA.schemaName, tenantId: tenantA.id }, async () => {
      await Qualification.bulkCreate(Array.from({ length: 45 }, (_, index) => ({
        name: `分页资质-${index + 1}`,
        category: '分页测试',
      })));
    });
    const baseHeaders = { Authorization: `Bearer ${globalToken}`, 'X-Tenant-ID': tenantA.id };
    const pages = await Promise.all([1, 2, 3].map((page) =>
      request.get(`/api/qualifications?category=${encodeURIComponent('分页测试')}&page=${page}&pageSize=20`)
        .set(baseHeaders)));
    expect(pages.map((response) => response.body.data.items.length)).toEqual([20, 20, 5]);
    expect(pages[0].body.data.pagination.total).toBe(45);
    expect(pages[0].body.data.summary).toMatchObject({ total: 45, missing: 45 });

    const hidden = await request.put(`/api/qualifications/${tenantBQualificationId}`)
      .set(baseHeaders)
      .send({ name: '越权修改', category: '企业资质' });
    expect(hidden.status).toBe(404);

    const hiddenTask = await request.get(`/api/tasks/${tenantBTaskId}`).set(baseHeaders);
    expect(hiddenTask.status).toBe(404);
  });

  test('two scheduler instances execute one leased schedule only once', async () => {
    const { TaskSchedule } = require('../src/models');
    const { CronSchedulerService } = require('../src/services/account/cronScheduler.service');
    const auditTaskService = require('../src/services/account/auditTask.service').default;
    const schedule = await TaskSchedule.create({
      tenantId: tenantA.id,
      tenantSchema: tenantA.schemaName,
      taskId: '00000000-0000-4000-8000-000000000001',
      cronExpression: '* * * * *',
      enabled: true,
    });
    const execution = jest.spyOn(auditTaskService, 'executeTaskScheduled').mockResolvedValue({
      executionId: 'execution-1',
      status: 'SUCCESS',
    });
    await Promise.all([
      new CronSchedulerService().runScheduleNow(schedule.id),
      new CronSchedulerService().runScheduleNow(schedule.id),
    ]);
    expect(execution).toHaveBeenCalledTimes(1);
    execution.mockRestore();
  });

  test('scheduler marks a timed-out execution failed and applies backoff', async () => {
    const { TaskSchedule } = require('../src/models');
    const { CronSchedulerService } = require('../src/services/account/cronScheduler.service');
    const auditTaskService = require('../src/services/account/auditTask.service').default;
    const schedule = await TaskSchedule.create({
      tenantId: tenantA.id,
      tenantSchema: tenantA.schemaName,
      taskId: '00000000-0000-4000-8000-000000000002',
      cronExpression: '* * * * *',
      enabled: true,
    });
    const execution = jest.spyOn(auditTaskService, 'executeTaskScheduled')
      .mockImplementation(() => new Promise(() => {}));

    await new CronSchedulerService(25).runScheduleNow(schedule.id);
    await schedule.reload();

    expect(schedule.lastOutcome).toBe('failed');
    expect(schedule.consecutiveFailures).toBe(1);
    expect(schedule.workerId).toBeNull();
    expect(schedule.leasedUntil.getTime()).toBeGreaterThan(Date.now());
    execution.mockRestore();
  });
});
