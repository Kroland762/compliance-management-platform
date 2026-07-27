import { Transaction } from 'sequelize';
import sequelize from '../config/database';
import Tenant, { TenantStatus } from '../models/Tenant';
import RoleTemplate from '../models/RoleTemplate';
import Role from '../models/Role';
import Department from '../models/Department';
import { migrateUp } from '../config/migrations/runner';
import { runWithTenantContext } from '../middlewares/tenant';
import memberService from './member.service';

const SLUG_PATTERN = /^[a-z0-9_]{1,50}$/;

export interface ProvisionTenantInput {
  name: string;
  slug: string;
  domain?: string | null;
  admin: {
    username: string;
    displayName: string;
    email?: string | null;
  };
}

export interface ProvisionTenantResult {
  tenant: Tenant;
  bootstrapCredentials: {
    username: string;
    temporaryPassword: string;
    mustChangePassword: true;
  };
}

class TenantProvisioningService {
  async provision(input: ProvisionTenantInput): Promise<ProvisionTenantResult> {
    if (!input.name?.trim() || !SLUG_PATTERN.test(input.slug)) {
      throw new Error('租户名称必填，标识只能包含小写字母、数字和下划线，最长 50 位');
    }
    if (!input.admin?.username?.trim() || !input.admin?.displayName?.trim()) {
      throw new Error('必须提供首位租户管理员的用户名和姓名');
    }
    if (await Tenant.findOne({ where: { slug: input.slug } })) {
      throw new Error(`租户标识 "${input.slug}" 已存在`);
    }

    const schemaName = `tenant_${input.slug}`;
    const tenant = await sequelize.transaction(async (transaction: Transaction) => Tenant.create({
      name: input.name.trim(),
      slug: input.slug,
      domain: input.domain?.trim() || null,
      status: TenantStatus.PROVISIONING,
      schemaName,
    }, { transaction }));

    try {
      await migrateUp([schemaName]);
      const templates = await RoleTemplate.findAll({ where: { isSystem: true } });
      if (templates.length === 0) throw new Error('尚未初始化系统角色模板');
      const result = await runWithTenantContext(
        { schema: schemaName, tenantId: tenant.id },
        () => sequelize.transaction(async (transaction) => {
          const roles: Role[] = [];
          for (const template of templates) {
            roles.push(await Role.create({
              tenantId: tenant.id,
              name: template.name,
              description: template.description,
              permissions: template.permissions,
              permissionScopes: template.permissionScopes,
              isSystem: true,
              systemKey: template.systemKey,
              isLocked: template.isLocked,
            }, { transaction }));
          }
          const adminRole = roles.find((role) => role.systemKey === 'tenant_admin');
          if (!adminRole) throw new Error('系统角色模板缺少 tenant_admin');
          const root = await Department.create({
            name: '总部',
            code: 'ROOT',
            parentId: null,
            description: '租户根部门',
            sortOrder: 0,
            managerMemberId: null,
            status: 'active',
          }, { transaction });
          const created = await memberService.createLocal({
            username: input.admin.username.trim(),
            displayName: input.admin.displayName.trim(),
            email: input.admin.email?.trim() || null,
            roleIds: [adminRole.id],
            departments: [{ departmentId: root.id, isPrimary: true }],
            createdSource: 'provisioning',
          }, transaction);
          await root.update({ managerMemberId: created.member.id }, { transaction });
          return created;
        }),
      );
      await tenant.update({ status: TenantStatus.ACTIVE, config: null });
      return {
        tenant,
        bootstrapCredentials: {
          username: input.admin.username.trim(),
          temporaryPassword: result.temporaryPassword,
          mustChangePassword: true,
        },
      };
    } catch (error) {
      await tenant.update({
        status: TenantStatus.PROVISIONING,
        config: { provisioningError: error instanceof Error ? error.message : String(error) },
      }).catch(() => undefined);
      throw error;
    }
  }
}

export default new TenantProvisioningService();
