import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

interface Attributes {
  id: string;
  tenantId: string;
  tenantSchema: string;
  taskId: string;
  cronExpression: string;
  enabled: boolean;
  workerId: string | null;
  leasedUntil: Date | null;
  heartbeatAt: Date | null;
  lastRunAt: Date | null;
  lastOutcome: string | null;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<Attributes, 'id' | 'enabled' | 'workerId' | 'leasedUntil' | 'heartbeatAt' | 'lastRunAt' | 'lastOutcome' | 'consecutiveFailures' | 'createdAt' | 'updatedAt'>;

class TaskSchedule extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare tenantId: string;
  declare tenantSchema: string;
  declare taskId: string;
  declare cronExpression: string;
  declare enabled: boolean;
  declare workerId: string | null;
  declare leasedUntil: Date | null;
  declare heartbeatAt: Date | null;
  declare lastRunAt: Date | null;
  declare lastOutcome: string | null;
  declare consecutiveFailures: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

TaskSchedule.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  tenantId: { type: DataTypes.UUID, allowNull: false },
  tenantSchema: { type: DataTypes.STRING(63), allowNull: false },
  taskId: { type: DataTypes.UUID, allowNull: false },
  cronExpression: { type: DataTypes.STRING(120), allowNull: false },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  workerId: { type: DataTypes.STRING(120), allowNull: true },
  leasedUntil: { type: DataTypes.DATE, allowNull: true },
  heartbeatAt: { type: DataTypes.DATE, allowNull: true },
  lastRunAt: { type: DataTypes.DATE, allowNull: true },
  lastOutcome: { type: DataTypes.STRING(30), allowNull: true },
  consecutiveFailures: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'task_schedules',
  schema: 'public',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['tenantId', 'taskId'] },
    { fields: ['enabled', 'leasedUntil'] },
  ],
});

export default TaskSchedule;
