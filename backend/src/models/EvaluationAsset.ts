import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

interface Attributes {
  id: string;
  questionItemId: string;
  taskId: string;
  templateQuestionId: string;
  assetId: string;
  createdAt: Date;
}

type CreationAttributes = Optional<Attributes, 'id' | 'createdAt'>;

class EvaluationAsset extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare questionItemId: string;
  declare taskId: string;
  declare templateQuestionId: string;
  declare assetId: string;
  declare createdAt: Date;
}

EvaluationAsset.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  questionItemId: { type: DataTypes.UUID, allowNull: false },
  taskId: { type: DataTypes.UUID, allowNull: false },
  templateQuestionId: { type: DataTypes.UUID, allowNull: false },
  assetId: { type: DataTypes.UUID, allowNull: false },
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'evaluation_assets',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['questionItemId', 'assetId'] },
    { unique: true, fields: ['taskId', 'templateQuestionId', 'assetId'] },
    { fields: ['assetId'] },
    { name: 'evaluation_assets_task_asset_idx', fields: ['taskId', 'assetId', 'questionItemId'] },
  ],
});

export default EvaluationAsset;
