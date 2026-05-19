import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import { OperationType } from './enums';
import User from './User';

interface AuditLogAttributes {
  id: string;
  userId: string;
  operationType: OperationType;
  resourceType: string;
  resourceId: string | null;
  operationDetails: string | null;
  success: boolean;
  ipAddress: string | null;
  createdAt: Date;
}

type CreationAttributes = Optional<AuditLogAttributes, 'id' | 'createdAt'>;

class AuditLog extends Model<AuditLogAttributes, CreationAttributes> implements AuditLogAttributes {
  declare id: string;
  declare userId: string;
  declare operationType: OperationType;
  declare resourceType: string;
  declare resourceId: string | null;
  declare operationDetails: string | null;
  declare success: boolean;
  declare ipAddress: string | null;
  declare createdAt: Date;
}

AuditLog.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false, references: { model: User, key: 'id' } },
    operationType: { type: DataTypes.ENUM(...Object.values(OperationType)), allowNull: false },
    resourceType: { type: DataTypes.STRING(50), allowNull: false },
    resourceId: { type: DataTypes.UUID, allowNull: true },
    operationDetails: { type: DataTypes.TEXT, allowNull: true },
    success: { type: DataTypes.BOOLEAN, allowNull: false },
    ipAddress: { type: DataTypes.STRING(45), allowNull: true },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: 'audit_logs', timestamps: false },
);

export default AuditLog;
