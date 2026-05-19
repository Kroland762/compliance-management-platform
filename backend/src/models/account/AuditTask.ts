import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../../config/database';

export enum ScheduleType {
  MANUAL = 'MANUAL',
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  CRON = 'CRON',
}

export enum TaskStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

interface AuditTaskAttributes {
  id: string;
  name: string;
  sourceId: string;
  selectedRules: string[];
  scheduleType: ScheduleType;
  scheduleConfig: object | null;
  status: TaskStatus;
  lastExecTime: Date | null;
  lastExecResult: object | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<AuditTaskAttributes, 'id' | 'createdAt' | 'updatedAt' | 'scheduleConfig' | 'lastExecTime' | 'lastExecResult'>;

class AccountAuditTask extends Model<AuditTaskAttributes, CreationAttributes> implements AuditTaskAttributes {
  declare id: string;
  declare name: string;
  declare sourceId: string;
  declare selectedRules: string[];
  declare scheduleType: ScheduleType;
  declare scheduleConfig: object | null;
  declare status: TaskStatus;
  declare lastExecTime: Date | null;
  declare lastExecResult: object | null;
  declare createdBy: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

AccountAuditTask.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  sourceId: { type: DataTypes.UUID, allowNull: false },
  selectedRules: { type: DataTypes.ARRAY(DataTypes.UUID), allowNull: false, defaultValue: [] },
  scheduleType: { type: DataTypes.STRING(20), allowNull: false },
  scheduleConfig: { type: DataTypes.JSONB, allowNull: true },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: TaskStatus.ACTIVE },
  lastExecTime: { type: DataTypes.DATE, allowNull: true },
  lastExecResult: { type: DataTypes.JSONB, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'account_audit_tasks',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

export default AccountAuditTask;
