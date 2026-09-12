import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import {
  RiskCreationMode,
  RiskDiscoverySource,
  RiskLevel,
  RiskLifecycleStatus,
  TreatmentStrategy,
} from './enums';
import AuditTask from './AuditTask';
import User from './User';

interface Attributes {
  id: string;
  code: string;
  taskId: string | null;
  creationMode: RiskCreationMode;
  discoverySource: RiskDiscoverySource;
  discoverySourceDetail: string | null;
  sourceReference: string | null;
  createdBy: string;
  reviewerUserId: string | null;
  title: string;
  description: string;
  riskLevel: RiskLevel;
  treatmentStrategy: TreatmentStrategy;
  ownerDepartmentId: string;
  ownerUserId: string;
  dueDate: Date | null;
  status: RiskLifecycleStatus;
  identifiedAt: Date;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  acceptedBy: string | null;
  acceptedAt: Date | null;
  acceptanceReason: string | null;
  reviewDueDate: Date | null;
  closedBy: string | null;
  closedAt: Date | null;
  closeComment: string | null;
  lockVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<Attributes,
  'id' | 'taskId' | 'reviewerUserId' | 'discoverySourceDetail' | 'sourceReference' |
  'treatmentStrategy' | 'dueDate' | 'status' | 'identifiedAt' |
  'confirmedBy' | 'confirmedAt' | 'acceptedBy' | 'acceptedAt' |
  'acceptanceReason' | 'reviewDueDate' | 'closedBy' | 'closedAt' |
  'closeComment' | 'lockVersion' | 'createdAt' | 'updatedAt'>;

class RiskRecord extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare code: string;
  declare taskId: string | null;
  declare creationMode: RiskCreationMode;
  declare discoverySource: RiskDiscoverySource;
  declare discoverySourceDetail: string | null;
  declare sourceReference: string | null;
  declare createdBy: string;
  declare reviewerUserId: string | null;
  declare title: string;
  declare description: string;
  declare riskLevel: RiskLevel;
  declare treatmentStrategy: TreatmentStrategy;
  declare ownerDepartmentId: string;
  declare ownerUserId: string;
  declare dueDate: Date | null;
  declare status: RiskLifecycleStatus;
  declare identifiedAt: Date;
  declare confirmedBy: string | null;
  declare confirmedAt: Date | null;
  declare acceptedBy: string | null;
  declare acceptedAt: Date | null;
  declare acceptanceReason: string | null;
  declare reviewDueDate: Date | null;
  declare closedBy: string | null;
  declare closedAt: Date | null;
  declare closeComment: string | null;
  declare lockVersion: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

RiskRecord.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  code: { type: DataTypes.STRING(32), allowNull: false },
  taskId: { type: DataTypes.UUID, allowNull: true, references: { model: AuditTask, key: 'id' }, onDelete: 'RESTRICT' },
  creationMode: { type: DataTypes.STRING(24), allowNull: false, validate: { isIn: [Object.values(RiskCreationMode)] } },
  discoverySource: { type: DataTypes.STRING(32), allowNull: false, validate: { isIn: [Object.values(RiskDiscoverySource)] } },
  discoverySourceDetail: { type: DataTypes.TEXT, allowNull: true },
  sourceReference: { type: DataTypes.STRING(300), allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: false, references: { model: User, key: 'id' } },
  reviewerUserId: { type: DataTypes.UUID, allowNull: true, references: { model: User, key: 'id' } },
  title: { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: false },
  riskLevel: { type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [Object.values(RiskLevel)] } },
  treatmentStrategy: { type: DataTypes.STRING(20), allowNull: false, defaultValue: TreatmentStrategy.MITIGATE },
  ownerDepartmentId: { type: DataTypes.UUID, allowNull: false },
  ownerUserId: { type: DataTypes.UUID, allowNull: false },
  dueDate: { type: DataTypes.DATEONLY, allowNull: true },
  status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: RiskLifecycleStatus.PENDING_CONFIRMATION },
  identifiedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  confirmedBy: { type: DataTypes.UUID, allowNull: true },
  confirmedAt: { type: DataTypes.DATE, allowNull: true },
  acceptedBy: { type: DataTypes.UUID, allowNull: true },
  acceptedAt: { type: DataTypes.DATE, allowNull: true },
  acceptanceReason: { type: DataTypes.TEXT, allowNull: true },
  reviewDueDate: { type: DataTypes.DATEONLY, allowNull: true },
  closedBy: { type: DataTypes.UUID, allowNull: true },
  closedAt: { type: DataTypes.DATE, allowNull: true },
  closeComment: { type: DataTypes.TEXT, allowNull: true },
  lockVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'risk_records',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['code'] },
    { fields: ['taskId', 'status'] },
    { fields: ['creationMode', 'status'] },
    { fields: ['discoverySource', 'status'] },
    { fields: ['ownerDepartmentId', 'status'] },
    { fields: ['ownerUserId', 'status'] },
    { fields: ['riskLevel', 'identifiedAt'] },
  ],
});

export default RiskRecord;
