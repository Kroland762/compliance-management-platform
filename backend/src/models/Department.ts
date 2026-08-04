import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

interface DepartmentAttributes {
  id: string;
  name: string;
  parentId: string | null;
  description: string | null;
  sortOrder: number;
  code: string;
  managerMemberId: string | null;
  status: 'active' | 'archived';
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<DepartmentAttributes, 'id' | 'parentId' | 'description' | 'sortOrder' | 'managerMemberId' | 'status' | 'archivedAt' | 'createdAt' | 'updatedAt'>;

class Department extends Model<DepartmentAttributes, CreationAttributes> implements DepartmentAttributes {
  declare id: string;
  declare name: string;
  declare parentId: string | null;
  declare description: string | null;
  declare sortOrder: number;
  declare code: string;
  declare managerMemberId: string | null;
  declare status: 'active' | 'archived';
  declare archivedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Department.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  parentId: { type: DataTypes.UUID, allowNull: true },
  description: { type: DataTypes.STRING(255), allowNull: true },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  code: { type: DataTypes.STRING(60), allowNull: false },
  managerMemberId: { type: DataTypes.UUID, allowNull: true },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active' },
  archivedAt: { type: DataTypes.DATE, allowNull: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'departments',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  indexes: [
    { fields: ['parentId'] },
    { unique: true, fields: ['parentId', 'name'] },
    { unique: true, fields: ['code'] },
  ],
});

export default Department;
