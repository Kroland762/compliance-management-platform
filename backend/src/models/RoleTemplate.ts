import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import type { PermissionMatrix } from './Role';

interface RoleTemplateAttributes {
  id: string;
  name: string;
  description: string | null;
  permissions: PermissionMatrix;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<RoleTemplateAttributes, 'id' | 'description' | 'createdAt' | 'updatedAt'>;

class RoleTemplate extends Model<RoleTemplateAttributes, CreationAttributes> implements RoleTemplateAttributes {
  declare id: string;
  declare name: string;
  declare description: string | null;
  declare permissions: PermissionMatrix;
  declare isSystem: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
}

RoleTemplate.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  description: { type: DataTypes.STRING(255), allowNull: true },
  permissions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  isSystem: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'role_templates',
  schema: 'public',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

export default RoleTemplate;
