import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

export type AssetStatus = 'active' | 'archived';
export type AssetCriticality = 'low' | 'medium' | 'high' | 'critical';

interface Attributes {
  id: string;
  code: string;
  name: string;
  assetType: string;
  criticality: AssetCriticality;
  ownerDepartmentId: string | null;
  ownerUserId: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  status: AssetStatus;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<Attributes,
  'id' | 'criticality' | 'ownerDepartmentId' | 'ownerUserId' | 'description' |
  'metadata' | 'status' | 'archivedAt' | 'createdAt' | 'updatedAt'>;

class Asset extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare code: string;
  declare name: string;
  declare assetType: string;
  declare criticality: AssetCriticality;
  declare ownerDepartmentId: string | null;
  declare ownerUserId: string | null;
  declare description: string | null;
  declare metadata: Record<string, unknown>;
  declare status: AssetStatus;
  declare archivedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Asset.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  code: { type: DataTypes.STRING(64), allowNull: false },
  name: { type: DataTypes.STRING(200), allowNull: false },
  assetType: { type: DataTypes.STRING(32), allowNull: false },
  criticality: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'medium' },
  ownerDepartmentId: { type: DataTypes.UUID, allowNull: true },
  ownerUserId: { type: DataTypes.UUID, allowNull: true },
  description: { type: DataTypes.TEXT, allowNull: true },
  metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'active' },
  archivedAt: { type: DataTypes.DATE, allowNull: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'assets',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['code'] },
    { fields: ['status', 'assetType'] },
    { fields: ['ownerDepartmentId'] },
  ],
});

export default Asset;
