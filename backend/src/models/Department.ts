import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

interface DepartmentAttributes {
  id: string;
  name: string;
  parentId: string | null;
  description: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<DepartmentAttributes, 'id' | 'parentId' | 'description' | 'sortOrder' | 'createdAt' | 'updatedAt'>;

class Department extends Model<DepartmentAttributes, CreationAttributes> implements DepartmentAttributes {
  declare id: string;
  declare name: string;
  declare parentId: string | null;
  declare description: string | null;
  declare sortOrder: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Department.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  parentId: { type: DataTypes.UUID, allowNull: true },
  description: { type: DataTypes.STRING(255), allowNull: true },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'departments',
  schema: 'public',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  indexes: [
    { fields: ['parentId'] },
    { unique: true, fields: ['parentId', 'name'] },
  ],
});

export default Department;
