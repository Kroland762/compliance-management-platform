import bcrypt from 'bcrypt';
import sequelize from '../config/database';
import { setupAssociations } from '../models/associations';
import { User, UserRole, Role, PermissionMatrix } from '../models';

const ADMIN_PERMISSIONS: PermissionMatrix = {
  users:           ['create', 'read', 'update', 'delete'],
  templates:       ['create', 'read', 'update', 'delete'],
  tasks:           ['create', 'read', 'update', 'delete', 'submit', 'return'],
  risks:           ['read', 'update'],
  audit_logs:      ['read', 'export'],
  notifications:   ['read', 'update'],
  export:          ['create'],
  settings:        ['read', 'update'],
  data_sources:    ['create', 'read', 'update', 'delete', 'sync'],
  rules:           ['create', 'read', 'update', 'delete', 'toggle'],
  account_tasks:   ['create', 'read', 'update', 'delete', 'execute'],
  problems:        ['read', 'update', 'export'],
  dashboard:       ['read'],
};

const AUDITOR_PERMISSIONS: PermissionMatrix = {
  templates:       ['read'],
  tasks:           ['create', 'read', 'update', 'submit', 'return'],
  risks:           ['read', 'update'],
  notifications:   ['read', 'update'],
  export:          ['create'],
  settings:        ['read'],
  data_sources:    ['read'],
  rules:           ['read'],
  account_tasks:   ['read', 'execute'],
  problems:        ['read', 'update', 'export'],
  dashboard:       ['read'],
};

const USER_PERMISSIONS: PermissionMatrix = {
  tasks:           ['read', 'update', 'submit'],
  notifications:   ['read', 'update'],
  settings:        ['read'],
  problems:        ['read'],
  dashboard:       ['read'],
};

async function seed() {
  try {
    setupAssociations();
    await sequelize.sync({ alter: true });

    // 创建默认角色
    const [adminRole] = await Role.findOrCreate({
      where: { name: '管理员' },
      defaults: { name: '管理员', description: '系统管理员，拥有全部权限', permissions: ADMIN_PERMISSIONS, isSystem: true },
    });
    const [auditorRole] = await Role.findOrCreate({
      where: { name: '审计员' },
      defaults: { name: '审计员', description: '审计员，可操作审计流程', permissions: AUDITOR_PERMISSIONS, isSystem: true },
    });
    const [userRole] = await Role.findOrCreate({
      where: { name: '普通用户' },
      defaults: { name: '普通用户', description: '普通用户，可查看和填写', permissions: USER_PERMISSIONS, isSystem: true },
    });

    console.log('✅ 默认角色已创建:', adminRole.name, auditorRole.name, userRole.name);

    // 更新已有用户的 roleId（如果有旧用户没 roleId）
    await User.update({ roleId: adminRole.id }, { where: { role: UserRole.ADMINISTRATOR, roleId: null as any } });
    await User.update({ roleId: auditorRole.id }, { where: { role: UserRole.AUDITOR, roleId: null as any } });
    await User.update({ roleId: userRole.id }, { where: { role: UserRole.USER, roleId: null as any } });

    const passwordHash = await bcrypt.hash('Admin1234', 10);

    // 创建默认管理员
    await User.findOrCreate({
      where: { username: 'admin' },
      defaults: {
        username: 'admin',
        passwordHash,
        department: 'IT',
        email: 'admin@audit.com',
        role: UserRole.ADMINISTRATOR,
        roleId: adminRole.id,
        isActive: true,
      },
    });

    // 创建默认审计员
    await User.findOrCreate({
      where: { username: 'auditor' },
      defaults: {
        username: 'auditor',
        passwordHash: await bcrypt.hash('Auditor1234', 10),
        department: '安全部',
        email: 'auditor@audit.com',
        role: UserRole.AUDITOR,
        roleId: auditorRole.id,
        isActive: true,
      },
    });

    // 创建默认普通用户
    await User.findOrCreate({
      where: { username: 'respondent' },
      defaults: {
        username: 'respondent',
        passwordHash: await bcrypt.hash('Respondent1234', 10),
        department: '业务部',
        email: 'respondent@audit.com',
        role: UserRole.USER,
        roleId: userRole.id,
        isActive: true,
      },
    });

    console.log('✅ 种子数据已创建');
    console.log('   admin / Admin1234 (管理员)');
    console.log('   auditor / Auditor1234 (审计员)');
    console.log('   respondent / Respondent1234 (普通用户)');

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ 种子数据创建失败:', error);
    process.exit(1);
  }
}

seed();
