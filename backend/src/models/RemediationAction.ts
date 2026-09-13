import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import { RemediationActionStatus } from './enums';

interface Attributes {
  id: string;
  code: string;
  title: string;
  description: string;
  ownerUserId: string;
  ownerDepartmentId: string;
  startDate: Date | null;
  dueDate: Date;
  status: RemediationActionStatus;
  progressNote: string | null;
  submittedAt: Date | null;
  completedAt: Date | null;
  createdBy: string;
  lockVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<Attributes,
  'id' | 'startDate' | 'status' | 'progressNote' | 'submittedAt' | 'completedAt' |
  'lockVersion' | 'createdAt' | 'updatedAt'>;

class RemediationAction extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare code: string;
  declare title: string;
  declare description: string;
  declare ownerUserId: string;
  declare ownerDepartmentId: string;
  declare startDate: Date | null;
  declare dueDate: Date;
  declare status: RemediationActionStatus;
  declare progressNote: string | null;
  declare submittedAt: Date | null;
  declare completedAt: Date | null;
  declare createdBy: string;
  declare lockVersion: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

RemediationAction.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  code: { type: DataTypes.STRING(32), allowNull: false },
  title: { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: false },
  ownerUserId: { type: DataTypes.UUID, allowNull: false },
  ownerDepartmentId: { type: DataTypes.UUID, allowNull: false },
  startDate: { type: DataTypes.DATEONLY, allowNull: true },
  dueDate: { type: DataTypes.DATEONLY, allowNull: false },
  status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: RemediationActionStatus.DRAFT },
  progressNote: { type: DataTypes.TEXT, allowNull: true },
  submittedAt: { type: DataTypes.DATE, allowNull: true },
  completedAt: { type: DataTypes.DATE, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: false },
  lockVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'remediation_actions',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['code'] },
    { fields: ['ownerUserId', 'status'] },
    { fields: ['ownerDepartmentId', 'dueDate'] },
  ],
});

export default RemediationAction;
