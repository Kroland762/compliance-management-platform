import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import { UserRole } from './enums';

interface UserAttributes {
  id: string;
  username: string;
  passwordHash: string;
  department: string | null;
  email: string | null;
  role: UserRole;
  roleId: string | null;
  tenantId: string | null;
  lastLogin: Date | null;
  isActive: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

type UserCreationAttributes = Optional<UserAttributes, 'id' | 'createdAt' | 'updatedAt' | 'lastLogin' | 'failedLoginAttempts' | 'lockedUntil' | 'roleId' | 'tenantId' | 'tokenVersion'>;

class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  declare id: string;
  declare username: string;
  declare passwordHash: string;
  declare department: string | null;
  declare email: string | null;
  declare role: UserRole;
  declare roleId: string | null;
  declare tenantId: string | null;

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
    department: { type: DataTypes.STRING(100), allowNull: true },
    email: { type: DataTypes.STRING(200), allowNull: true },
    role: { type: DataTypes.STRING(30), allowNull: false, validate: { isIn: [Object.values(UserRole)] } },
    roleId: { type: DataTypes.UUID, allowNull: true },
    tenantId: { type: DataTypes.UUID, allowNull: true },
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
