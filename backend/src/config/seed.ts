import bcrypt from 'bcrypt';
import sequelize from './database';
import { setupAssociations } from '../models/associations';
import { PermissionMatrix, RoleTemplate, User, UserRole } from '../models';
import { migrateUp } from './migrations/runner';

export const ADMIN_PERMISSIONS: PermissionMatrix = {
  tenants: ['create', 'read', 'update', 'delete'],
  users: ['create', 'read', 'update', 'delete'],
  templates: ['create', 'read', 'update', 'delete'],
  qualifications: ['create', 'read', 'update', 'delete'],
  tasks: ['create', 'read', 'update', 'delete', 'submit', 'return'],
  risks: ['read', 'update'],
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
  qualifications: ['create', 'read', 'update'],
  tasks: ['create', 'read', 'update', 'submit', 'return'],
  risks: ['read', 'update'],
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
  tasks: ['read', 'update', 'submit'],
  notifications: ['read', 'update'],
  settings: ['read'],
  dashboard: ['read'],
};

async function seed(): Promise<void> {
  setupAssociations();
  await migrateUp();

  const templates = [
    ['管理员', '系统管理员，拥有租户内全部权限', ADMIN_PERMISSIONS],
    ['审计员', '审计员，可操作审计流程', AUDITOR_PERMISSIONS],
    ['普通用户', '普通用户，可查看和填写', USER_PERMISSIONS],
  ] as const;

  let adminTemplate: RoleTemplate | null = null;
  for (const [name, description, permissions] of templates) {
    const [template] = await RoleTemplate.findOrCreate({
      where: { name },
      defaults: { name, description, permissions, isSystem: true },
    });
    await template.update({ description, permissions, isSystem: true });
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
      department: '平台管理',
      email: process.env.SEED_ADMIN_EMAIL || null,
      role: UserRole.ADMINISTRATOR,
      roleId: adminTemplate.id,
      tenantId: null,
      isActive: true,
    },
  });
  await admin.update({ roleId: adminTemplate.id, tenantId: null });
  console.log(`✅ 控制面管理员 ${admin.username} 已就绪`);
}

seed()
  .catch((error) => {
    console.error('❌ 种子数据创建失败:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
