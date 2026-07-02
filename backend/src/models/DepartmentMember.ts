import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

interface DepartmentMemberAttributes {
  id: string;
  departmentId: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<DepartmentMemberAttributes, 'id' | 'createdAt' | 'updatedAt'>;

class DepartmentMember extends Model<DepartmentMemberAttributes, CreationAttributes> implements DepartmentMemberAttributes {
  declare id: string;
  declare departmentId: string;
  declare userId: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}

DepartmentMember.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  departmentId: { type: DataTypes.UUID, allowNull: false },
  userId: { type: DataTypes.UUID, allowNull: false },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'department_members',
  schema: 'public',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  indexes: [
    { unique: true, fields: ['departmentId', 'userId'] },
    { fields: ['userId'] },
  ],
});

export default DepartmentMember;
