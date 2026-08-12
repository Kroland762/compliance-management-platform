import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import { FindingDisposition, FindingStatus, RiskLevel } from './enums';

interface Attributes {
  id: string;
  code: string;
  taskId: string;
  evaluationId: string;
  title: string;
  description: string;
  severity: RiskLevel;
  status: FindingStatus;
  disposition: FindingDisposition;
  ownerDepartmentId: string;
  ownerUserId: string;
  dueDate: Date | null;
  createdBy: string;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionComment: string | null;
  lockVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<Attributes,
  'id' | 'status' | 'disposition' | 'dueDate' | 'resolvedBy' | 'resolvedAt' |
  'resolutionComment' | 'lockVersion' | 'createdAt' | 'updatedAt'>;

class Finding extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare code: string;
  declare taskId: string;
  declare evaluationId: string;
  declare title: string;
  declare description: string;
  declare severity: RiskLevel;
  declare status: FindingStatus;
  declare disposition: FindingDisposition;
  declare ownerDepartmentId: string;
  declare ownerUserId: string;
  declare dueDate: Date | null;
  declare createdBy: string;
  declare resolvedBy: string | null;
  declare resolvedAt: Date | null;
  declare resolutionComment: string | null;
  declare lockVersion: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Finding.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  code: { type: DataTypes.STRING(32), allowNull: false },
  taskId: { type: DataTypes.UUID, allowNull: false },
  evaluationId: { type: DataTypes.UUID, allowNull: false },
  title: { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: false },
  severity: { type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [Object.values(RiskLevel)] } },
  status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: FindingStatus.OPEN, validate: { isIn: [Object.values(FindingStatus)] } },
  disposition: { type: DataTypes.STRING(24), allowNull: false, defaultValue: FindingDisposition.PENDING, validate: { isIn: [Object.values(FindingDisposition)] } },
  ownerDepartmentId: { type: DataTypes.UUID, allowNull: false },
  ownerUserId: { type: DataTypes.UUID, allowNull: false },
  dueDate: { type: DataTypes.DATEONLY, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: false },
  resolvedBy: { type: DataTypes.UUID, allowNull: true },
  resolvedAt: { type: DataTypes.DATE, allowNull: true },
  resolutionComment: { type: DataTypes.TEXT, allowNull: true },
  lockVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'findings',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['code'] },
    { unique: true, fields: ['evaluationId'] },
    { fields: ['taskId', 'status'] },
    { fields: ['ownerUserId', 'status'] },
    { fields: ['ownerDepartmentId', 'status'] },
  ],
});

export default Finding;
