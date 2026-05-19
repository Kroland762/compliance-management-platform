import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../../config/database';

export enum DataSourceType {
  DATABASE = 'DATABASE',
  CSV = 'CSV',
}

export enum DataSourceStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum MappingStatus {
  CONFIGURED = 'CONFIGURED',
  UNCONFIGURED = 'UNCONFIGURED',
}

export enum DataTier {
  HOT = 'HOT',
  WARM = 'WARM',
  COLD = 'COLD',
}

interface DataSourceAttributes {
  id: string;
  name: string;
  sourceType: DataSourceType;
  connectionConfig: object | null;
  csvConfig: object | null;
  fieldMappingConfig: object;
  mappingStatus: MappingStatus;
  status: DataSourceStatus;
  totalAccounts: number;
  lastSyncTime: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<DataSourceAttributes, 'id' | 'createdAt' | 'updatedAt' | 'totalAccounts' | 'lastSyncTime' | 'connectionConfig' | 'csvConfig'>;

class DataSource extends Model<DataSourceAttributes, CreationAttributes> implements DataSourceAttributes {
  declare id: string;
  declare name: string;
  declare sourceType: DataSourceType;
  declare connectionConfig: object | null;
  declare csvConfig: object | null;
  declare fieldMappingConfig: object;
  declare mappingStatus: MappingStatus;
  declare status: DataSourceStatus;
  declare totalAccounts: number;
  declare lastSyncTime: Date | null;
  declare createdBy: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

DataSource.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  sourceType: { type: DataTypes.STRING(20), allowNull: false },
  connectionConfig: { type: DataTypes.JSONB, allowNull: true },
  csvConfig: { type: DataTypes.JSONB, allowNull: true },
  fieldMappingConfig: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  mappingStatus: { type: DataTypes.STRING(20), allowNull: false, defaultValue: MappingStatus.UNCONFIGURED },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: DataSourceStatus.ACTIVE },
  totalAccounts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  lastSyncTime: { type: DataTypes.DATE, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'account_data_sources',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

export default DataSource;
