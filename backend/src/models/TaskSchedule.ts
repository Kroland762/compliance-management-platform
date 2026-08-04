import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

export enum PersistentScheduleStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

interface TaskScheduleAttributes {
  id: string;
  tenantId: string | null;
  schemaName: string;
  taskId: string;
  cronExpression: string;
  timezone: string;
  status: PersistentScheduleStatus;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  failureCount: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<TaskScheduleAttributes,
  'id' | 'tenantId' | 'timezone' | 'status' | 'lastRunAt' | 'lockedAt' | 'lockedBy' |
  'failureCount' | 'lastError' | 'createdAt' | 'updatedAt'>;

class TaskSchedule extends Model<TaskScheduleAttributes, CreationAttributes> implements TaskScheduleAttributes {
  declare id: string;
  declare tenantId: string | null;
  declare schemaName: string;
  declare taskId: string;
  declare cronExpression: string;
  declare timezone: string;
  declare status: PersistentScheduleStatus;
  declare nextRunAt: Date;
  declare lastRunAt: Date | null;
  declare lockedAt: Date | null;
  declare lockedBy: string | null;
  declare failureCount: number;
  declare lastError: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

TaskSchedule.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  tenantId: { type: DataTypes.UUID, allowNull: true },
  schemaName: { type: DataTypes.STRING(63), allowNull: false, defaultValue: 'public' },
  taskId: { type: DataTypes.UUID, allowNull: false },
  cronExpression: { type: DataTypes.STRING(100), allowNull: false },
  timezone: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'Asia/Shanghai' },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: PersistentScheduleStatus.ACTIVE },
  nextRunAt: { type: DataTypes.DATE, allowNull: false },
  lastRunAt: { type: DataTypes.DATE, allowNull: true },
  lockedAt: { type: DataTypes.DATE, allowNull: true },
  lockedBy: { type: DataTypes.STRING(100), allowNull: true },
  failureCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  lastError: { type: DataTypes.TEXT, allowNull: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'task_schedules',
  schema: 'public',
  timestamps: true,
  indexes: [
    { name: 'uq_task_schedules_schema_task', unique: true, fields: ['schemaName', 'taskId'] },
    { fields: ['status', 'nextRunAt'] },
  ],
});

export default TaskSchedule;
