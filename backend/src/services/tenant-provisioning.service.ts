import { Transaction } from 'sequelize';
import sequelize from '../config/database';
import Tenant, { TenantStatus } from '../models/Tenant';
import RoleTemplate from '../models/RoleTemplate';
import Role from '../models/Role';
import { migrateUp } from '../config/migrations/runner';
import { runWithTenantContext } from '../middlewares/tenant';

const SLUG_PATTERN = /^[a-z0-9_]{1,50}$/;

class TenantProvisioningService {
  async provision(input: { name: string; slug: string; domain?: string | null }): Promise<Tenant> {
    if (!input.name?.trim() || !SLUG_PATTERN.test(input.slug)) {
      throw new Error('租户名称必填，标识只能包含小写字母、数字和下划线，最长 50 位');
    }
    const existing = await Tenant.findOne({ where: { slug: input.slug } });
    if (existing) throw new Error(`租户标识 "${input.slug}" 已存在`);

    const schemaName = `tenant_${input.slug}`;
    const tenant = await sequelize.transaction(async (transaction: Transaction) => Tenant.create({
      name: input.name.trim(),
      slug: input.slug,
      domain: input.domain?.trim() || null,
      status: TenantStatus.ACTIVE,
      schemaName,
    }, { transaction }));

    try {
      await migrateUp([schemaName]);
      const templates = await RoleTemplate.findAll({ where: { isSystem: true } });
      await runWithTenantContext({ schema: schemaName, tenantId: tenant.id }, async () => {
        for (const template of templates) {
          await Role.create({
            tenantId: tenant.id,
            name: template.name,
            description: template.description,
            permissions: template.permissions,
            isSystem: true,
          });
        }
      });
      return tenant;
    } catch (error) {
      await tenant.destroy().catch(() => undefined);
      throw error;
    }
  }
}

export default new TenantProvisioningService();
