const runIntegration = process.env.RUN_PG_INTEGRATION === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('tenant identity, membership, roles and organization governance', () => {
  let sequelize;
  let request;
  let jwt;
  let bcrypt;
  let tenantA;
  let tenantB;
  let tenantAToken;
  let tenantBToken;
  let identityToken;
  let sharedUser;
  let memberA;
  let memberB;
  let departmentA;
  let departmentB;
  let roleA;
  let roleB;
  let taskB;
  let qualificationB;
  const sharedPassword = 'SharedMember123!';

  beforeAll(async () => {
    const supertest = require('supertest');
    jwt = require('jsonwebtoken');
    bcrypt = require('bcrypt');
    sequelize = require('../src/config/database').default;
    request = supertest(require('../src/index').createApp());
    const { migrateUp } = require('../src/config/migrations/runner');
    const {
      AuditTask,
      Department,
      DepartmentMember,
      MemberRole,
      Qualification,
      QuestionnaireTemplate,
      Role,
      RoleTemplate,
      TenantMember,
      User,
    } = require('../src/models');
    const provisioning = require('../src/services/tenant-provisioning.service').default;
    const { runWithTenantContext } = require('../src/middlewares/tenant');

    await migrateUp();
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const provisionA = await provisioning.provision({
      name: '身份治理租户甲',
      slug: `identity_a_${suffix}`,
      admin: {
        username: `bootstrap_a_${suffix}`,
        displayName: '甲租户首位管理员',
        email: `bootstrap-a-${suffix}@example.com`,
      },
    });
    const provisionB = await provisioning.provision({
      name: '身份治理租户乙',
      slug: `identity_b_${suffix}`,
      admin: {
        username: `bootstrap_b_${suffix}`,
        displayName: '乙租户首位管理员',
        email: `bootstrap-b-${suffix}@example.com`,
      },
    });
    tenantA = provisionA.tenant;
    tenantB = provisionB.tenant;

    sharedUser = await User.create({
      username: `shared_${suffix}`,
      passwordHash: await bcrypt.hash(sharedPassword, 12),
      email: `shared-${suffix}@example.com`,
      globalRoleTemplateId: null,
      mustChangePassword: false,
      isActive: true,
    });

    await runWithTenantContext({ schema: tenantA.schemaName, tenantId: tenantA.id }, async () => {
      roleA = await Role.findOne({ where: { systemKey: 'tenant_admin' } });
      departmentA = await Department.findOne({ where: { code: 'ROOT' } });
      memberA = await TenantMember.create({
        userId: sharedUser.id,
        displayName: '同一身份（甲）',
        employeeNo: 'A-001',
        status: 'active',
        joinedAt: new Date(),
        createdSource: 'invitation',
      });
      await MemberRole.create({ memberId: memberA.id, roleId: roleA.id });
      await DepartmentMember.create({
        memberId: memberA.id,
        departmentId: departmentA.id,
        isPrimary: true,
      });
    });

    await runWithTenantContext({ schema: tenantB.schemaName, tenantId: tenantB.id }, async () => {
      roleB = await Role.findOne({ where: { systemKey: 'auditor' } });
      const memberRole = await Role.findOne({ where: { systemKey: 'member' } });
      departmentB = await Department.findOne({ where: { code: 'ROOT' } });
      memberB = await TenantMember.create({
        userId: sharedUser.id,
        displayName: '同一身份（乙）',
        employeeNo: 'B-009',
        status: 'active',
        joinedAt: new Date(),
        createdSource: 'invitation',
      });
      await MemberRole.bulkCreate([
        { memberId: memberB.id, roleId: roleB.id },
        { memberId: memberB.id, roleId: memberRole.id },
      ]);
      await DepartmentMember.create({
        memberId: memberB.id,
        departmentId: departmentB.id,
        isPrimary: true,
      });
      qualificationB = await Qualification.create({
        name: '乙租户私有资质',
        category: '企业资质',
        ownerDepartmentId: departmentB.id,
        responsibleUserId: sharedUser.id,
        createdBy: sharedUser.id,
      });
      const template = await QuestionnaireTemplate.create({
        name: '乙租户私有模板',
        description: null,
        createdBy: sharedUser.id,
      });
      taskB = await AuditTask.create({
        templateId: template.id,
        assessmentType: 'ISO27001',
        assessmentTarget: '乙租户私有任务',
        createdBy: sharedUser.id,
        assignedTo: sharedUser.id,
        reviewerId: sharedUser.id,
        departmentId: departmentB.id,
        status: 'draft',
      });
    });

    identityToken = jwt.sign({
      kind: 'identity',
      userId: sharedUser.id,
      username: sharedUser.username,
      tokenVersion: sharedUser.tokenVersion,
      passwordChangeRequired: false,
      isGlobalAdmin: false,
    }, process.env.JWT_SECRET, { expiresIn: 600 });
  }, 90_000);

  afterAll(async () => {
    await sequelize.close();
  });

  test('one global identity selects either tenant and receives different member context', async () => {
    const contexts = await request.get('/api/auth/contexts')
      .set('Authorization', `Bearer ${identityToken}`);
    expect(contexts.status).toBe(200);
    expect(contexts.body.data.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([tenantA.id, tenantB.id]),
    );

    const selectedA = await request.post('/api/auth/context')
      .set('Authorization', `Bearer ${identityToken}`)
      .send({ tenantId: tenantA.id });
    expect(selectedA.status).toBe(200);
    expect(selectedA.body.data.user).toMatchObject({
      tenantId: tenantA.id,
      memberId: memberA.id,
      primaryDepartmentId: departmentA.id,
    });
    tenantAToken = selectedA.body.data.token;

    const selectedB = await request.post('/api/auth/context')
      .set('Authorization', `Bearer ${identityToken}`)
      .send({ tenantId: tenantB.id });
    expect(selectedB.status).toBe(200);
    expect(selectedB.body.data.user).toMatchObject({
      tenantId: tenantB.id,
      memberId: memberB.id,
      primaryDepartmentId: departmentB.id,
    });
    expect(selectedB.body.data.user.roleIds).toHaveLength(2);
    expect(selectedB.body.data.user.permissions.tasks).toEqual(
      expect.arrayContaining(['read', 'update', 'submit']),
    );
    tenantBToken = selectedB.body.data.token;
  });

  test('forged tenant header is 403 and cross-tenant object ids are indistinguishable 404s', async () => {
    const forged = await request.get('/api/members')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .set('X-Tenant-ID', tenantB.id);
    expect(forged.status).toBe(403);
    expect(forged.body.error.code).toBe('FORBIDDEN');

    const hiddenTask = await request.get(`/api/tasks/${taskB.id}`)
      .set('Authorization', `Bearer ${tenantAToken}`);
    expect(hiddenTask.status).toBe(404);

    const hiddenQualification = await request.put(`/api/qualifications/${qualificationB.id}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: '越权修改' });
    expect(hiddenQualification.status).toBe(404);
  });

  test('member session version revokes an issued tenant token immediately', async () => {
    const { TenantMember } = require('../src/models');
    const { runWithTenantContext } = require('../src/middlewares/tenant');
    await runWithTenantContext(
      { schema: tenantB.schemaName, tenantId: tenantB.id },
      () => memberB.increment('sessionVersion'),
    );
    const revoked = await request.get('/api/stats')
      .set('Authorization', `Bearer ${tenantBToken}`);
    expect(revoked.status).toBe(401);
    expect(revoked.body.error.code).toBe('UNAUTHORIZED');

    await runWithTenantContext(
      { schema: tenantB.schemaName, tenantId: tenantB.id },
      () => TenantMember.findByPk(memberB.id).then((row) => row.reload()),
    );
  });

  test('active members require exactly one primary department and at least one role', async () => {
    const { DepartmentMember, MemberRole } = require('../src/models');
    const { runWithTenantContext } = require('../src/middlewares/tenant');
    await runWithTenantContext({ schema: tenantA.schemaName, tenantId: tenantA.id }, async () => {
      const primaryCount = await DepartmentMember.count({
        where: { memberId: memberA.id, isPrimary: true },
      });
      const roleCount = await MemberRole.count({ where: { memberId: memberA.id } });
      expect(primaryCount).toBe(1);
      expect(roleCount).toBeGreaterThan(0);
    });
  });

  test('temporary password accounts can only change password or logout', async () => {
    const { User } = require('../src/models');
    const provisioning = require('../src/services/tenant-provisioning.service').default;
    const suffix = Math.random().toString(36).slice(2, 8);
    const result = await provisioning.provision({
      name: '临时密码租户',
      slug: `temporary_${Date.now()}_${suffix}`,
      admin: {
        username: `temporary_admin_${suffix}`,
        displayName: '临时管理员',
      },
    });
    const captchaService = require('../src/services/captcha.service').default;
    const captcha = jest.spyOn(captchaService, 'verify').mockReturnValueOnce(true);
    const login = await request.post('/api/auth/login').send({
      username: result.bootstrapCredentials.username,
      password: result.bootstrapCredentials.temporaryPassword,
      captchaId: 'integration-captcha',
      captchaCode: 'abcd',
    });
    captcha.mockRestore();
    expect(login.status).toBe(200);
    expect(login.body.data.status).toBe('password_change_required');

    const denied = await request.get('/api/auth/contexts')
      .set('Authorization', `Bearer ${login.body.data.token}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(denied.body.error.message).toContain('修改密码');

    const changed = await request.post('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.data.token}`)
      .send({
        oldPassword: result.bootstrapCredentials.temporaryPassword,
        newPassword: 'ChangedPassword123!',
      });
    expect(changed.status).toBe(200);
    const user = await User.findOne({ where: { username: result.bootstrapCredentials.username } });
    expect(user.mustChangePassword).toBe(false);
  }, 60_000);

  test('legacy tenant upgrade deterministically migrates one role and one department membership', async () => {
    const { randomUUID } = require('crypto');
    const { QueryTypes } = require('sequelize');
    const migrations = require('../src/config/migrations/registry').default;
    const { migrationChecksum } = require('../src/config/migrations/registry');
    const { migrateUp } = require('../src/config/migrations/runner');
    const { User } = require('../src/models');
    const suffix = Math.random().toString(36).slice(2, 8);
    const schema = `tenant_legacy_${suffix}`;
    const tenantId = randomUUID();
    const roleId = randomUUID();
    const departmentId = randomUUID();
    const departmentMemberId = randomUUID();
    const legacyUser = await User.create({
      username: `legacy_${suffix}`,
      passwordHash: await bcrypt.hash('LegacyPassword123!', 12),
      email: null,
      globalRoleTemplateId: null,
      mustChangePassword: false,
      isActive: true,
    });
    const quote = `"${schema}"`;
    try {
      await sequelize.query(`ALTER TABLE public.users
        ADD COLUMN IF NOT EXISTS department varchar(100),
        ADD COLUMN IF NOT EXISTS role varchar(30),
        ADD COLUMN IF NOT EXISTS "roleId" uuid,
        ADD COLUMN IF NOT EXISTS "tenantId" uuid`);
      await sequelize.query(`UPDATE public.users
        SET department = 'Legacy Security', role = 'auditor', "roleId" = :roleId, "tenantId" = :tenantId
        WHERE id = :userId`, { replacements: { roleId, tenantId, userId: legacyUser.id } });
      await sequelize.query(`INSERT INTO public.tenants
        (id, name, slug, status, "schemaName", "createdAt", "updatedAt")
        VALUES (:tenantId, 'Legacy Tenant', :slug, 'active', :schema, now(), now())`, {
        replacements: { tenantId, slug: `legacy_${suffix}`, schema },
      });
      await sequelize.query(`CREATE SCHEMA ${quote}`);
      await sequelize.query(`
        CREATE TABLE ${quote}.roles (
          id uuid PRIMARY KEY, "tenantId" uuid NOT NULL, name varchar(50) NOT NULL,
          description varchar(255), permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
          "isSystem" boolean NOT NULL DEFAULT false,
          "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE ${quote}.departments (
          id uuid PRIMARY KEY, name varchar(100) NOT NULL, "parentId" uuid,
          description varchar(255), "sortOrder" integer NOT NULL DEFAULT 0,
          "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE ${quote}.department_members (
          id uuid PRIMARY KEY, "departmentId" uuid NOT NULL, "userId" uuid NOT NULL,
          "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE ${quote}.audit_tasks (id uuid PRIMARY KEY);
        CREATE TABLE ${quote}.qualifications (id uuid PRIMARY KEY);
        CREATE TABLE ${quote}.audit_logs (id uuid PRIMARY KEY);
        CREATE TABLE ${quote}.risk_records (id uuid PRIMARY KEY, "taskId" uuid);
      `);
      await sequelize.query(`INSERT INTO ${quote}.roles
        (id, "tenantId", name, permissions, "isSystem") VALUES (:roleId, :tenantId, 'Legacy Auditor', '{}', false);
        INSERT INTO ${quote}.departments (id, name) VALUES (:departmentId, 'Legacy Security');
        INSERT INTO ${quote}.department_members (id, "departmentId", "userId")
          VALUES (:departmentMemberId, :departmentId, :userId)`, {
        replacements: { roleId, tenantId, departmentId, departmentMemberId, userId: legacyUser.id },
      });
      for (const migrationId of ['001_tenant_business', '002_tenant_security_fields']) {
        const migration = migrations.find((item) => item.id === migrationId);
        await sequelize.query(`INSERT INTO public.schema_migrations
          (migration_id, schema_name, checksum) VALUES (:migrationId, :schema, :checksum)`, {
          replacements: { migrationId, schema, checksum: migrationChecksum(migration) },
        });
      }

      await migrateUp([schema]);
      const rows = await sequelize.query(`
        SELECT member."userId", role."roleId", department."departmentId", department."isPrimary"
        FROM ${quote}.tenant_members member
        JOIN ${quote}.member_roles role ON role."memberId" = member.id
        JOIN ${quote}.department_members department ON department."memberId" = member.id
        WHERE member."userId" = :userId
      `, { replacements: { userId: legacyUser.id }, type: QueryTypes.SELECT });
      expect(rows).toEqual([expect.objectContaining({
        userId: legacyUser.id,
        roleId,
        departmentId,
        isPrimary: true,
      })]);
      const legacyColumn = await sequelize.query(`
        SELECT count(*)::int AS count FROM information_schema.columns
        WHERE table_schema = :schema AND table_name = 'department_members' AND column_name = 'userId'
      `, { replacements: { schema }, type: QueryTypes.SELECT });
      expect(Number(legacyColumn[0].count)).toBe(0);
    } finally {
      await sequelize.query(`DROP SCHEMA IF EXISTS ${quote} CASCADE`);
      await sequelize.query('DELETE FROM public.schema_migrations WHERE schema_name = :schema', {
        replacements: { schema },
      });
      await sequelize.query('DELETE FROM public.tenants WHERE id = :tenantId', { replacements: { tenantId } });
      await legacyUser.destroy();
      await sequelize.query(`ALTER TABLE public.users
        DROP COLUMN IF EXISTS department,
        DROP COLUMN IF EXISTS role,
        DROP COLUMN IF EXISTS "roleId",
        DROP COLUMN IF EXISTS "tenantId"`);
    }
  }, 60_000);
});
