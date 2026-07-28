import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
interface UserAttributes {
  id: string;
  username: string;
  passwordHash: string;
  email: string | null;
  globalRoleTemplateId: string | null;
  mustChangePassword: boolean;
  lastLogin: Date | null;
  isActive: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

type UserCreationAttributes = Optional<UserAttributes, 'id' | 'createdAt' | 'updatedAt' | 'lastLogin' | 'failedLoginAttempts' | 'lockedUntil' | 'globalRoleTemplateId' | 'mustChangePassword' | 'tokenVersion'>;

class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  declare id: string;
  declare username: string;
  declare passwordHash: string;
  declare email: string | null;
  declare globalRoleTemplateId: string | null;
  declare mustChangePassword: boolean;

  declare lastLogin: Date | null;
  declare isActive: boolean;
  declare failedLoginAttempts: number;
  declare lockedUntil: Date | null;
  declare tokenVersion: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

User.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    username: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false },
    email: { type: DataTypes.STRING(200), allowNull: true },
    globalRoleTemplateId: { type: DataTypes.UUID, allowNull: true },
    mustChangePassword: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    lastLogin: { type: DataTypes.DATE, allowNull: true },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    failedLoginAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lockedUntil: { type: DataTypes.DATE, allowNull: true },
    tokenVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: 'users', schema: 'public', timestamps: true, underscored: true },
);

export default User;
