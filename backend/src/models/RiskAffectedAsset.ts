import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

interface Attributes {
  id: string;
  riskId: string;
  assetId: string;
  impactLevel: string | null;
  impactDescription: string | null;
  createdBy: string;
  createdAt: Date;
}

type CreationAttributes = Optional<Attributes, 'id' | 'impactLevel' | 'impactDescription' | 'createdAt'>;

class RiskAffectedAsset extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare riskId: string;
  declare assetId: string;
  declare impactLevel: string | null;
  declare impactDescription: string | null;
  declare createdBy: string;
  declare createdAt: Date;
}

RiskAffectedAsset.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  riskId: { type: DataTypes.UUID, allowNull: false },
  assetId: { type: DataTypes.UUID, allowNull: false },
  impactLevel: { type: DataTypes.STRING(16), allowNull: true },
  impactDescription: { type: DataTypes.TEXT, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: false },
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'risk_affected_assets',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['riskId', 'assetId'] },
    { fields: ['assetId'] },
  ],
});

export default RiskAffectedAsset;
