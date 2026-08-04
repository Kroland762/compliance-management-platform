import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

interface Attributes {
  id: string;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
  userId: string;
  resourceId: string | null;
  responseBody: Record<string, unknown>;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<Attributes,
  'id' | 'resourceId' | 'responseBody' | 'expiresAt' | 'createdAt' | 'updatedAt'>;

class IdempotencyRecord extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare operation: string;
  declare idempotencyKey: string;
  declare requestHash: string;
  declare userId: string;
  declare resourceId: string | null;
  declare responseBody: Record<string, unknown>;
  declare expiresAt: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}

IdempotencyRecord.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  operation: { type: DataTypes.STRING(80), allowNull: false },
  idempotencyKey: { type: DataTypes.STRING(180), allowNull: false },
  requestHash: { type: DataTypes.STRING(64), allowNull: false },
  userId: { type: DataTypes.UUID, allowNull: false },
  resourceId: { type: DataTypes.UUID, allowNull: true },
  responseBody: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
  },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'idempotency_records',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['operation', 'idempotencyKey', 'userId'] },
    { fields: ['expiresAt'] },
  ],
});

export default IdempotencyRecord;
