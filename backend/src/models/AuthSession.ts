import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import User from './User';

interface AuthSessionAttributes {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type AuthSessionCreationAttributes = Optional<
  AuthSessionAttributes,
  'revokedAt' | 'createdAt' | 'updatedAt'
>;

class AuthSession
  extends Model<AuthSessionAttributes, AuthSessionCreationAttributes>
  implements AuthSessionAttributes {
  declare id: string;
  declare userId: string;
  declare refreshTokenHash: string;
  declare expiresAt: Date;
  declare revokedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

AuthSession.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: User, key: 'id' },
      onDelete: 'CASCADE',
    },
    refreshTokenHash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    revokedAt: { type: DataTypes.DATE, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: 'auth_sessions',
    schema: 'public',
    timestamps: true,
  },
);

export default AuthSession;
