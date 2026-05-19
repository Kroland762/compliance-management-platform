import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

interface SystemSettingAttributes {
  key: string;
  value: string;
  updatedBy: string | null;
  updatedAt: Date;
}

type CreationAttributes = Optional<SystemSettingAttributes, 'updatedBy' | 'updatedAt'>;

class SystemSetting extends Model<SystemSettingAttributes, CreationAttributes> implements SystemSettingAttributes {
  declare key: string;
  declare value: string;
  declare updatedBy: string | null;
  declare updatedAt: Date;
}

SystemSetting.init({
  key: { type: DataTypes.STRING(100), primaryKey: true },
  value: { type: DataTypes.TEXT, allowNull: false },
  updatedBy: { type: DataTypes.UUID, allowNull: true },
  updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'system_settings',
  timestamps: false,
});

export default SystemSetting;
