import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

interface Attributes {
  id: string;
  currentEvaluationId: string;
  sourceEvaluationId: string;
  matchedAssetIds: string[];
  createdAt: Date;
}

type CreationAttributes = Optional<Attributes, 'id' | 'matchedAssetIds' | 'createdAt'>;

class EvaluationHistoryLink extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare currentEvaluationId: string;
  declare sourceEvaluationId: string;
  declare matchedAssetIds: string[];
  declare createdAt: Date;
}

EvaluationHistoryLink.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  currentEvaluationId: { type: DataTypes.UUID, allowNull: false },
  sourceEvaluationId: { type: DataTypes.UUID, allowNull: false },
  matchedAssetIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'evaluation_history_links',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['currentEvaluationId', 'sourceEvaluationId'] },
    { fields: ['sourceEvaluationId'] },
  ],
});

export default EvaluationHistoryLink;
