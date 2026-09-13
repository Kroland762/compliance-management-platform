import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import User from './User';

export enum TenantMemberStatus {
  INVITED = 'invited',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  LEFT = 'left',
}

interface TenantMemberAttributes {
  id: string;
  userId: string;
  employeeNo: string | null;
  displayName: string;
  email: string | null;
  status: TenantMemberStatus;
  sessionVersion: number;
  joinedAt: Date | null;
  leftAt: Date | null;
  createdSource: 'local' | 'invitation' | 'migration' | 'provisioning';
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<TenantMemberAttributes,
  'id' | 'employeeNo' | 'email' | 'status' | 'sessionVersion' | 'joinedAt' |
  'leftAt' | 'createdSource' | 'createdAt' | 'updatedAt'>;

class TenantMember extends Model<TenantMemberAttributes, CreationAttributes> implements TenantMemberAttributes {
  declare id: string;
  declare userId: string;
  declare employeeNo: string | null;
  declare displayName: string;
  declare email: string | null;
  declare status: TenantMemberStatus;
  declare sessionVersion: number;
  declare joinedAt: Date | null;
  declare leftAt: Date | null;
  declare createdSource: 'local' | 'invitation' | 'migration' | 'provisioning';
  declare createdAt: Date;
  declare updatedAt: Date;
}

TenantMember.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false, references: { model: User, key: 'id' } },
  employeeNo: { type: DataTypes.STRING(80), allowNull: true },
  displayName: { type: DataTypes.STRING(100), allowNull: false },
  email: { type: DataTypes.STRING(200), allowNull: true },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: TenantMemberStatus.ACTIVE },
  sessionVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  joinedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: DataTypes.NOW },
  leftAt: { type: DataTypes.DATE, allowNull: true },
  createdSource: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'local' },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'tenant_members',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['userId'] },
    { unique: true, fields: ['employeeNo'] },
    { fields: ['status'] },
  ],
});

export default TenantMember;
