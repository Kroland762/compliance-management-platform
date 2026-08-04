import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

interface DepartmentMemberAttributes {
  id: string;
  departmentId: string;
  memberId: string;
  isPrimary: boolean;
  positionTitle: string | null;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<DepartmentMemberAttributes, 'id' | 'isPrimary' | 'positionTitle' | 'joinedAt' | 'createdAt' | 'updatedAt'>;

class DepartmentMember extends Model<DepartmentMemberAttributes, CreationAttributes> implements DepartmentMemberAttributes {
  declare id: string;
  declare departmentId: string;
  declare memberId: string;
  declare isPrimary: boolean;
  declare positionTitle: string | null;
  declare joinedAt: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}

DepartmentMember.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  departmentId: { type: DataTypes.UUID, allowNull: false },
  memberId: { type: DataTypes.UUID, allowNull: false },
  isPrimary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  positionTitle: { type: DataTypes.STRING(100), allowNull: true },
  joinedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'department_members',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  indexes: [
    { unique: true, fields: ['departmentId', 'memberId'] },
    { fields: ['memberId'] },
  ],
});

export default DepartmentMember;
