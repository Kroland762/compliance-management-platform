import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

// 权限资源定义及可选操作
export const PERMISSION_DEFINITIONS = {
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
} as const;

export type PermissionResource = keyof typeof PERMISSION_DEFINITIONS;
export type PermissionAction = string;

// 完整权限矩阵类型: { users: string[], templates: string[], ... }
export type PermissionMatrix = {
  [K in PermissionResource]?: PermissionAction[];
};

const DEFAULT_PERMISSIONS: PermissionMatrix = {};

interface RoleAttributes {
  id: string;
  name: string;
  description: string | null;
  permissions: PermissionMatrix;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<RoleAttributes, 'id' | 'description' | 'createdAt' | 'updatedAt'>;

class Role extends Model<RoleAttributes, CreationAttributes> implements RoleAttributes {
  declare id: string;
  declare name: string;
  declare description: string | null;
  declare permissions: PermissionMatrix;
  declare isSystem: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;

  /** 检查是否拥有指定权限 */
  hasPermission(resource: PermissionResource, action: PermissionAction): boolean {
    const allowed = this.permissions[resource];
    if (!allowed || !Array.isArray(allowed)) return false;
    return allowed.includes(action);
  }
}

Role.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  description: { type: DataTypes.STRING(255), allowNull: true },
  permissions: { type: DataTypes.JSONB, allowNull: false, defaultValue: DEFAULT_PERMISSIONS },
  isSystem: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'roles',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

export default Role;
