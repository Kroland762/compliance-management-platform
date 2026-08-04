import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../../config/database';

export enum ExecutionStatus {
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export enum TriggerType {
  MANUAL = 'MANUAL',
  SCHEDULED = 'SCHEDULED',
}

export enum ExecutionPhase {
  SYNCING = 'SYNCING',
  MAPPING = 'MAPPING',
  MATCHING = 'MATCHING',
  SAVING = 'SAVING',
}

interface TaskExecutionAttributes {
  id: string;
  taskId: string;
  status: ExecutionStatus;
  currentPhase: ExecutionPhase | null;
  phaseProgress: number;
  startTime: Date;
  endTime: Date | null;
  accountsProcessed: number | null;
  problemsFound: number | null;
  errorMessage: string | null;
  triggerType: TriggerType;
  triggeredBy: string | null;
  attempt: number;
  maxAttempts: number;
  idempotencyKey: string | null;
  heartbeatAt: Date;
}

type CreationAttributes = Optional<TaskExecutionAttributes, 'id' | 'endTime' | 'accountsProcessed' | 'problemsFound' | 'errorMessage' | 'currentPhase' | 'phaseProgress' | 'attempt' | 'maxAttempts' | 'idempotencyKey' | 'heartbeatAt'>;

class TaskExecution extends Model<TaskExecutionAttributes, CreationAttributes> implements TaskExecutionAttributes {
  declare id: string;
  declare taskId: string;
  declare status: ExecutionStatus;
  declare currentPhase: ExecutionPhase | null;
  declare phaseProgress: number;
  declare startTime: Date;
  declare endTime: Date | null;
  declare accountsProcessed: number | null;
  declare problemsFound: number | null;
  declare errorMessage: string | null;
  declare triggerType: TriggerType;
  declare triggeredBy: string | null;
  declare attempt: number;
  declare maxAttempts: number;
  declare idempotencyKey: string | null;
  declare heartbeatAt: Date;
}

TaskExecution.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  taskId: { type: DataTypes.UUID, allowNull: false },
  status: { type: DataTypes.STRING(20), allowNull: false },
  currentPhase: { type: DataTypes.STRING(30), allowNull: true },
  phaseProgress: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  startTime: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  endTime: { type: DataTypes.DATE, allowNull: true },
  accountsProcessed: { type: DataTypes.INTEGER, allowNull: true },
  problemsFound: { type: DataTypes.INTEGER, allowNull: true },
  errorMessage: { type: DataTypes.TEXT, allowNull: true },
  triggerType: { type: DataTypes.STRING(20), allowNull: false },
  triggeredBy: { type: DataTypes.UUID, allowNull: true },
  attempt: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  maxAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  idempotencyKey: { type: DataTypes.STRING(180), allowNull: true },
  heartbeatAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'account_task_executions',
  timestamps: false,
  indexes: [
    { fields: ['taskId'] },
    { name: 'uq_task_execution_idempotency', unique: true, fields: ['idempotencyKey'] },
    { name: 'uq_task_execution_running', unique: true, fields: ['taskId'], where: { status: ExecutionStatus.RUNNING } },
    { fields: ['status', 'heartbeatAt'] },
  ],
});

export default TaskExecution;
