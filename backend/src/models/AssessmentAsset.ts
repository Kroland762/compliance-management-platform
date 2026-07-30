import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import AuditTask from './AuditTask';
import Asset from './Asset';

interface Attributes {
  id: string;
  taskId: string;
  assetId: string;
  scopeStatus: 'included' | 'excluded';
  assetCodeSnapshot: string;
  assetNameSnapshot: string;
  assetTypeSnapshot: string;
  criticalitySnapshot: string;
  ownerDepartmentIdSnapshot: string | null;
  addedBy: string;
  addedAt: Date;
}

type CreationAttributes = Optional<Attributes, 'id' | 'scopeStatus' | 'ownerDepartmentIdSnapshot' | 'addedAt'>;

class AssessmentAsset extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare taskId: string;
  declare assetId: string;
  declare scopeStatus: 'included' | 'excluded';
  declare assetCodeSnapshot: string;
  declare assetNameSnapshot: string;
  declare assetTypeSnapshot: string;
  declare criticalitySnapshot: string;
  declare ownerDepartmentIdSnapshot: string | null;
  declare addedBy: string;
  declare addedAt: Date;
}

AssessmentAsset.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  taskId: { type: DataTypes.UUID, allowNull: false, references: { model: AuditTask, key: 'id' } },
  assetId: { type: DataTypes.UUID, allowNull: false, references: { model: Asset, key: 'id' } },
  scopeStatus: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'included' },
  assetCodeSnapshot: { type: DataTypes.STRING(64), allowNull: false },
  assetNameSnapshot: { type: DataTypes.STRING(200), allowNull: false },
  assetTypeSnapshot: { type: DataTypes.STRING(32), allowNull: false },
  criticalitySnapshot: { type: DataTypes.STRING(16), allowNull: false },
  ownerDepartmentIdSnapshot: { type: DataTypes.UUID, allowNull: true },
  addedBy: { type: DataTypes.UUID, allowNull: false },
  addedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'assessment_assets',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['taskId', 'assetId'] },
    { fields: ['assetId'] },
  ],
});

export default AssessmentAsset;
