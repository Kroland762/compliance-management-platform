import bcrypt from 'bcrypt';
import sequelize from './database';
import { setupAssociations } from '../models/associations';
import { Department, Role, Tenant, TenantMember, User } from '../models';
import { migrateUp } from './migrations/runner';
import tenantProvisioningService from '../services/tenant-provisioning.service';
import memberService from '../services/member.service';
import { runWithTenantContext } from '../middlewares/tenant';

async function seedE2e(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed:e2e 禁止在生产环境运行');
  }
  const slug = process.env.E2E_MUTATION_TENANT_SLUG;
  const auditorUsername = process.env.E2E_AUDITOR_USERNAME;
  const auditorPassword = process.env.E2E_AUDITOR_PASSWORD;
  if (!slug || !auditorUsername || !auditorPassword) {
    throw new Error('必须设置 E2E_MUTATION_TENANT_SLUG、E2E_AUDITOR_USERNAME 和 E2E_AUDITOR_PASSWORD');
  }

  setupAssociations();
  await migrateUp();

  let tenant = await Tenant.findOne({ where: { slug } });
  if (!tenant) {
    const provisioned = await tenantProvisioningService.provision({
      name: 'CI Tenant',
      slug,
      admin: {
        username: `${slug}_tenant_admin`,
        displayName: 'CI Tenant Admin',
        email: `${slug}-tenant-admin@example.com`,
      },
    });
    tenant = provisioned.tenant;
  }

  await migrateUp([tenant.schemaName]);
  await runWithTenantContext(
    { schema: tenant.schemaName, tenantId: tenant.id },
    async () => {
      const auditorRole = await Role.findOne({ where: { systemKey: 'auditor' } });
      const rootDepartment = await Department.findOne({ where: { parentId: null } });
      if (!auditorRole || !rootDepartment) throw new Error('E2E 租户缺少审计员角色或根部门');

      const existingUser = await User.findOne({ where: { username: auditorUsername } });
      if (existingUser) {
        const existingMember = await TenantMember.findOne({ where: { userId: existingUser.id } });
        if (!existingMember) throw new Error(`用户 ${auditorUsername} 已存在但不属于 E2E 租户`);
        await existingUser.update({
          passwordHash: await bcrypt.hash(auditorPassword, 12),
          mustChangePassword: false,
          isActive: true,
        });
        return;
      }

      const created = await memberService.createLocal({
        username: auditorUsername,
        displayName: 'CI Auditor',
        email: `${auditorUsername}@example.com`,
        password: auditorPassword,
        roleIds: [auditorRole.id],
        departments: [{ departmentId: rootDepartment.id, isPrimary: true }],
        createdSource: 'local',
      });
      await User.update({ mustChangePassword: false }, { where: { id: created.member.userId } });
    },
  );
}

seedE2e()
  .then(() => console.log('E2E fixture tenant and auditor are ready'))
  .catch((error) => {
    console.error('E2E fixture seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
