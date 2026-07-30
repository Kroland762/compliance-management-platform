import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import { AssessmentPlanExecutionStatus } from './enums';

interface Attributes {
  id: string;
  planId: string;
  taskId: string | null;
  triggerTime: Date;
  status: AssessmentPlanExecutionStatus;
  idempotencyKey: string;
  workerId: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<Attributes,
  'id' | 'taskId' | 'status' | 'workerId' | 'errorMessage' | 'createdAt' | 'updatedAt'>;

class AssessmentPlanExecution extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare planId: string;
  declare taskId: string | null;
  declare triggerTime: Date;
  declare status: AssessmentPlanExecutionStatus;
  declare idempotencyKey: string;
  declare workerId: string | null;
  declare errorMessage: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

AssessmentPlanExecution.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  planId: { type: DataTypes.UUID, allowNull: false },
  taskId: { type: DataTypes.UUID, allowNull: true },
  triggerTime: { type: DataTypes.DATE, allowNull: false },
  status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: AssessmentPlanExecutionStatus.PENDING },
  idempotencyKey: { type: DataTypes.STRING(180), allowNull: false },
  workerId: { type: DataTypes.STRING(120), allowNull: true },
  errorMessage: { type: DataTypes.TEXT, allowNull: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'assessment_plan_executions',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['idempotencyKey'] },
    { fields: ['planId', 'triggerTime'] },
  ],
});

export default AssessmentPlanExecution;
