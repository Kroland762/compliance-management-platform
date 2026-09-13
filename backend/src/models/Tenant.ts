import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

export enum TenantStatus {
  PROVISIONING = 'provisioning',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  ARCHIVED = 'archived',
}

interface TenantAttributes {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  status: TenantStatus;
  schemaName: string;
  config: object | null;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<TenantAttributes, 'id' | 'domain' | 'config' | 'createdAt' | 'updatedAt'>;

class Tenant extends Model<TenantAttributes, CreationAttributes> implements TenantAttributes {
  declare id: string;
  declare name: string;
  declare slug: string;
  declare domain: string | null;
  declare status: TenantStatus;
  declare schemaName: string;
  declare config: object | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Tenant.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  slug: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  domain: { type: DataTypes.STRING(255), allowNull: true },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: TenantStatus.ACTIVE },
  schemaName: { type: DataTypes.STRING(63), allowNull: false, unique: true },
  config: { type: DataTypes.JSONB, allowNull: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'tenants',
  schema: 'public',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

export default Tenant;
