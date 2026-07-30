import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

interface Attributes {
  id: string;
  riskId: string;
  controlEvaluationId: string;
  relationType: 'primary' | 'supporting';
  rationale: string | null;
  createdBy: string;
  createdAt: Date;
}

type CreationAttributes = Optional<Attributes, 'id' | 'relationType' | 'rationale' | 'createdAt'>;

class RiskSource extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare riskId: string;
  declare controlEvaluationId: string;
  declare relationType: 'primary' | 'supporting';
  declare rationale: string | null;
  declare createdBy: string;
  declare createdAt: Date;
}

RiskSource.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  riskId: { type: DataTypes.UUID, allowNull: false },
  controlEvaluationId: { type: DataTypes.UUID, allowNull: false },
  relationType: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'primary' },
  rationale: { type: DataTypes.TEXT, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: false },
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'risk_sources',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['riskId', 'controlEvaluationId'] },
    { fields: ['controlEvaluationId'] },
  ],
});

export default RiskSource;
