import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../../config/database';

export enum ProblemStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  RESOLVED = 'RESOLVED',
  AUTO_RESOLVED = 'AUTO_RESOLVED',
  FALSE_POSITIVE = 'FALSE_POSITIVE',
  IGNORED = 'IGNORED',
}

interface ProblemAccountAttributes {
  id: string;
  taskId: string;
  accountDataId: string | null;
  ruleId: string;
  accountId: string;
  problemDescription: string;
  severity: string;
  status: ProblemStatus;
  firstDetectedAt: Date;
  lastSeenAt: Date | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNotes: string | null;
  auditBatchId: string;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<ProblemAccountAttributes, 'id' | 'lastSeenAt' | 'resolvedAt' | 'resolvedBy' | 'resolutionNotes' | 'createdAt' | 'updatedAt'>;

class ProblemAccount extends Model<ProblemAccountAttributes, CreationAttributes> implements ProblemAccountAttributes {
  declare id: string;
  declare taskId: string;
  declare accountDataId: string | null;
  declare ruleId: string;
  declare accountId: string;
  declare problemDescription: string;
  declare severity: string;
  declare status: ProblemStatus;
  declare firstDetectedAt: Date;
  declare lastSeenAt: Date | null;
  declare resolvedAt: Date | null;
  declare resolvedBy: string | null;
  declare resolutionNotes: string | null;
  declare auditBatchId: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}

ProblemAccount.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  taskId: { type: DataTypes.UUID, allowNull: false },
  accountDataId: { type: DataTypes.UUID, allowNull: true },
  ruleId: { type: DataTypes.UUID, allowNull: false },
  accountId: { type: DataTypes.STRING(255), allowNull: false },
  problemDescription: { type: DataTypes.TEXT, allowNull: false },
  severity: { type: DataTypes.STRING(20), allowNull: false },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: ProblemStatus.PENDING },
  firstDetectedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  lastSeenAt: { type: DataTypes.DATE, allowNull: true },
  resolvedAt: { type: DataTypes.DATE, allowNull: true },
  resolvedBy: { type: DataTypes.UUID, allowNull: true },
  resolutionNotes: { type: DataTypes.TEXT, allowNull: true },
  auditBatchId: { type: DataTypes.STRING(64), allowNull: false },
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'account_problems',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  indexes: [
    { fields: ['taskId'] },
    { fields: ['accountId', 'ruleId'] },
    { fields: ['status'] },
    { fields: ['auditBatchId'] },
  ],
});

export default ProblemAccount;
