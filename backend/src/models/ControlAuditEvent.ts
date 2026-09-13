import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

interface Attributes {
  id: string;
  eventType: string;
  actorUserId: string | null;
  tenantId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  outcome: string;
  details: object;
  requestId: string | null;
  createdAt: Date;
}

type CreationAttributes = Optional<Attributes, 'id' | 'actorUserId' | 'tenantId' | 'resourceType' | 'resourceId' | 'details' | 'requestId' | 'createdAt'>;

class ControlAuditEvent extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare eventType: string;
  declare actorUserId: string | null;
  declare tenantId: string | null;
  declare resourceType: string | null;
  declare resourceId: string | null;
  declare outcome: string;
  declare details: object;
  declare requestId: string | null;
  declare createdAt: Date;
}

ControlAuditEvent.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  eventType: { type: DataTypes.STRING(80), allowNull: false },
  actorUserId: { type: DataTypes.UUID, allowNull: true },
  tenantId: { type: DataTypes.UUID, allowNull: true },
  resourceType: { type: DataTypes.STRING(80), allowNull: true },
  resourceId: { type: DataTypes.STRING(100), allowNull: true },
  outcome: { type: DataTypes.STRING(20), allowNull: false },
  details: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  requestId: { type: DataTypes.UUID, allowNull: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'control_audit_events',
  schema: 'public',
  timestamps: false,
  indexes: [
    { fields: ['tenantId', 'createdAt'] },
    { fields: ['eventType', 'createdAt'] },
  ],
});

export default ControlAuditEvent;
