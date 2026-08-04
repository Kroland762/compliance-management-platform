import bcrypt from 'bcrypt';
import sequelize from './database';
import { setupAssociations } from '../models/associations';
import { PermissionMatrix, PermissionScopeMatrix, RoleTemplate, User } from '../models';
import { migrateUp } from './migrations/runner';

export const ADMIN_PERMISSIONS: PermissionMatrix = {
  tenants: ['create', 'read', 'update', 'delete'],
  users: ['create', 'read', 'update', 'delete'],
  templates: ['create', 'read', 'update', 'delete'],
  assets: ['create', 'read', 'update', 'archive'],
  qualifications: ['create', 'read', 'update', 'delete'],
  tasks: ['create', 'read', 'update', 'delete', 'submit', 'return', 'publish', 'cancel'],
  evaluations: ['read', 'answer', 'submit', 'review'],
  risks: ['create', 'read', 'update', 'confirm', 'assign', 'accept', 'verify', 'close', 'export'],
  remediation_actions: ['create', 'read', 'update', 'submit', 'verify', 'link'],
  assessment_plans: ['create', 'read', 'update', 'delete', 'execute'],
  audit_logs: ['read', 'export'],
  notifications: ['read', 'update'],
  export: ['create'],
  settings: ['read', 'update'],
  organization: ['create', 'read', 'update', 'delete'],
  data_sources: ['create', 'read', 'update', 'delete', 'sync'],
  rules: ['create', 'read', 'update', 'delete', 'toggle'],
  account_tasks: ['create', 'read', 'update', 'delete', 'execute'],
  problems: ['read', 'update', 'export'],
  dashboard: ['read'],
  account_dashboard: ['read'],
};

export const AUDITOR_PERMISSIONS: PermissionMatrix = {
  templates: ['read'],
  assets: ['read'],
  qualifications: ['create', 'read', 'update'],
  tasks: ['create', 'read', 'update', 'submit', 'return', 'publish'],
  evaluations: ['read', 'answer', 'submit', 'review'],
  risks: ['create', 'read', 'update', 'confirm', 'assign', 'accept', 'verify', 'close', 'export'],
  remediation_actions: ['create', 'read', 'update', 'submit', 'verify', 'link'],
  assessment_plans: ['create', 'read', 'update', 'execute'],
  notifications: ['read', 'update'],
  export: ['create'],
  settings: ['read'],
  organization: ['read'],
  data_sources: ['read'],
  rules: ['read'],
  account_tasks: ['read', 'execute'],
  problems: ['read', 'update', 'export'],
  dashboard: ['read'],
  account_dashboard: ['read'],
};

export const USER_PERMISSIONS: PermissionMatrix = {
  assets: ['read'],
  tasks: ['read', 'update', 'submit'],
  evaluations: ['read', 'answer', 'submit'],
  risks: ['read'],
  remediation_actions: ['read', 'update', 'submit'],
  notifications: ['read', 'update'],
  settings: ['read'],
  dashboard: ['read'],
};

function scopesFor(permissions: PermissionMatrix, scope: 'all' | 'assigned'): PermissionScopeMatrix {
  return Object.fromEntries(
    Object.entries(permissions).map(([resource, actions]) => [
      resource,
      Object.fromEntries((actions || []).map((action) => [action, scope])),
    ]),
  ) as PermissionScopeMatrix;
}

async function seed(): Promise<void> {
  setupAssociations();
  await migrateUp();

  const templates = [
    ['管理员', '系统管理员，拥有租户内全部权限', ADMIN_PERMISSIONS, scopesFor(ADMIN_PERMISSIONS, 'all'), 'tenant_admin'],
    ['审计员', '审计员，可操作审计流程', AUDITOR_PERMISSIONS, scopesFor(AUDITOR_PERMISSIONS, 'assigned'), 'auditor'],
    ['普通用户', '普通用户，可查看和填写', USER_PERMISSIONS, scopesFor(USER_PERMISSIONS, 'assigned'), 'member'],
  ] as const;

  let adminTemplate: RoleTemplate | null = null;
  for (const [name, description, permissions, permissionScopes, systemKey] of templates) {
    const [template] = await RoleTemplate.findOrCreate({
      where: { name },
      defaults: { name, description, permissions, permissionScopes, systemKey, isSystem: true, isLocked: true },
    });
    await template.update({ description, permissions, permissionScopes, systemKey, isSystem: true, isLocked: true });
    if (name === '管理员') adminTemplate = template;
  }
  if (!adminTemplate) throw new Error('无法创建全局管理员角色模板');

  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    console.log('ℹ️ 已创建角色模板；未设置 SEED_ADMIN_PASSWORD，跳过默认管理员创建');
    return;
  }
  const [admin] = await User.findOrCreate({
    where: { username: process.env.SEED_ADMIN_USERNAME || 'admin' },
    defaults: {
      username: process.env.SEED_ADMIN_USERNAME || 'admin',
      passwordHash: await bcrypt.hash(password, 12),
      email: process.env.SEED_ADMIN_EMAIL || null,
      globalRoleTemplateId: adminTemplate.id,
      mustChangePassword: false,
      isActive: true,
    },
  });
  await admin.update({ globalRoleTemplateId: adminTemplate.id });
  console.log(`✅ 控制面管理员 ${admin.username} 已就绪`);
}

seed()
  .catch((error) => {
    console.error('❌ 种子数据创建失败:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
