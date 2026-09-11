import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../../config/database';
import { ProblemStatus } from './ProblemAccount';

export enum ProblemStatusChangeSource {
  MANUAL = 'MANUAL',
  BULK = 'BULK',
  AUTO = 'AUTO',
  MIGRATION = 'MIGRATION',
}

interface ProblemStatusHistoryAttributes {
  id: string;
  problemId: string;
  fromStatus: ProblemStatus | null;
  toStatus: ProblemStatus;
  changedBy: string | null;
  source: ProblemStatusChangeSource;
  notes: string | null;
  changedAt: Date;
}

type CreationAttributes = Optional<ProblemStatusHistoryAttributes, 'id' | 'fromStatus' | 'changedBy' | 'notes' | 'changedAt'>;

class ProblemStatusHistory extends Model<ProblemStatusHistoryAttributes, CreationAttributes> implements ProblemStatusHistoryAttributes {
  declare id: string;
  declare problemId: string;
  declare fromStatus: ProblemStatus | null;
  declare toStatus: ProblemStatus;
  declare changedBy: string | null;
  declare source: ProblemStatusChangeSource;
  declare notes: string | null;
  declare changedAt: Date;
}

ProblemStatusHistory.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  problemId: { type: DataTypes.UUID, allowNull: false },
  fromStatus: { type: DataTypes.STRING(20), allowNull: true },
  toStatus: { type: DataTypes.STRING(20), allowNull: false },
  changedBy: { type: DataTypes.UUID, allowNull: true },
  source: { type: DataTypes.STRING(20), allowNull: false },
  notes: { type: DataTypes.TEXT, allowNull: true },
  changedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'account_problem_status_history',
  timestamps: false,
  indexes: [{ fields: ['problemId', 'changedAt'] }],
});

export default ProblemStatusHistory;
