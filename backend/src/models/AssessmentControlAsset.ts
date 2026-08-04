import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

interface Attributes {
  id: string;
  taskId: string;
  controlPointId: string;
  assetId: string;
  assignedTo: string | null;
  responsibleDepartmentId: string;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<Attributes, 'id' | 'assignedTo' | 'createdAt' | 'updatedAt'>;

class AssessmentControlAsset extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare taskId: string;
  declare controlPointId: string;
  declare assetId: string;
  declare assignedTo: string | null;
  declare responsibleDepartmentId: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}

AssessmentControlAsset.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  taskId: { type: DataTypes.UUID, allowNull: false },
  controlPointId: { type: DataTypes.UUID, allowNull: false },
  assetId: { type: DataTypes.UUID, allowNull: false },
  assignedTo: { type: DataTypes.UUID, allowNull: true },
  responsibleDepartmentId: { type: DataTypes.UUID, allowNull: false },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'assessment_control_assets',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['taskId', 'controlPointId', 'assetId'] },
    { fields: ['assetId'] },
    { fields: ['assignedTo'] },
  ],
});

export default AssessmentControlAsset;
