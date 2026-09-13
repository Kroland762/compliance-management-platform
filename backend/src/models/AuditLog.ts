import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import { OperationType } from './enums';
import User from './User';

interface AuditLogAttributes {
  id: string;
  eventType: string;
  requestId: string | null;
  userId: string;
  memberId: string | null;
  operationType: OperationType;
  resourceType: string;
  resourceId: string | null;
  relatedResourceIds: Record<string, unknown>;
  operationDetails: string | null;
  success: boolean;
  result: string;
  reasonCode: string | null;
  durationMs: number | null;
  ipAddress: string | null;
  tenantId: string | null;
  departmentId: string | null;
  departmentIdSnapshot: string | null;
  createdAt: Date;
}

type CreationAttributes = Optional<AuditLogAttributes,
  'id' | 'eventType' | 'requestId' | 'memberId' | 'resourceId' | 'relatedResourceIds' |
  'operationDetails' | 'result' | 'reasonCode' | 'durationMs' | 'ipAddress' | 'tenantId' |
  'departmentId' | 'departmentIdSnapshot' | 'createdAt'>;

class AuditLog extends Model<AuditLogAttributes, CreationAttributes> implements AuditLogAttributes {
  declare id: string;
  declare eventType: string;
  declare requestId: string | null;
  declare userId: string;
  declare memberId: string | null;
  declare operationType: OperationType;
  declare resourceType: string;
  declare resourceId: string | null;
  declare relatedResourceIds: Record<string, unknown>;
  declare operationDetails: string | null;
  declare success: boolean;
  declare result: string;
  declare reasonCode: string | null;
  declare durationMs: number | null;
  declare ipAddress: string | null;
  declare tenantId: string | null;
  declare departmentId: string | null;
  declare departmentIdSnapshot: string | null;
  declare createdAt: Date;
}

AuditLog.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    eventType: { type: DataTypes.STRING(120), allowNull: false, defaultValue: 'legacy.operation' },
    requestId: { type: DataTypes.UUID, allowNull: true },
    userId: { type: DataTypes.UUID, allowNull: false, references: { model: User, key: 'id' } },
    memberId: { type: DataTypes.UUID, allowNull: true },
    operationType: { type: DataTypes.STRING(30), allowNull: false, validate: { isIn: [Object.values(OperationType)] } },
    resourceType: { type: DataTypes.STRING(50), allowNull: false },
    resourceId: { type: DataTypes.UUID, allowNull: true },
    relatedResourceIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    operationDetails: { type: DataTypes.TEXT, allowNull: true },
    success: { type: DataTypes.BOOLEAN, allowNull: false },
    result: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'success' },
    reasonCode: { type: DataTypes.STRING(80), allowNull: true },
    durationMs: { type: DataTypes.INTEGER, allowNull: true },
    ipAddress: { type: DataTypes.STRING(45), allowNull: true },
    tenantId: { type: DataTypes.UUID, allowNull: true },
    departmentId: { type: DataTypes.UUID, allowNull: true },
    departmentIdSnapshot: { type: DataTypes.UUID, allowNull: true },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: 'audit_logs', timestamps: false },
);

export default AuditLog;
