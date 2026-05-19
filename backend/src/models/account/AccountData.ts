import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../../config/database';
import { DataTier } from './DataSource';

interface AccountDataAttributes {
  id: string;
  sourceId: string;
  sourceAccountId: string;
  accountId: string;
  accountName: string | null;
  accountPermission: string | null;
  createdTime: Date | null;
  lastLoginTime: Date | null;
  mfaEnabled: boolean | null;
  accountStatus: string | null;
  customFields: object | null;
  sourceRawData: object;
  importBatchId: string;
  dataTier: DataTier;
  createdAt: Date;
}

type CreationAttributes = Optional<AccountDataAttributes, 'id' | 'createdAt' | 'accountName' | 'accountPermission' | 'createdTime' | 'lastLoginTime' | 'mfaEnabled' | 'accountStatus' | 'customFields'>;

class AccountData extends Model<AccountDataAttributes, CreationAttributes> implements AccountDataAttributes {
  declare id: string;
  declare sourceId: string;
  declare sourceAccountId: string;
  declare accountId: string;
  declare accountName: string | null;
  declare accountPermission: string | null;
  declare createdTime: Date | null;
  declare lastLoginTime: Date | null;
  declare mfaEnabled: boolean | null;
  declare accountStatus: string | null;
  declare customFields: object | null;
  declare sourceRawData: object;
  declare importBatchId: string;
  declare dataTier: DataTier;
  declare createdAt: Date;
}

AccountData.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  sourceId: { type: DataTypes.UUID, allowNull: false },
  sourceAccountId: { type: DataTypes.STRING(255), allowNull: false },
  accountId: { type: DataTypes.STRING(255), allowNull: false },
  accountName: { type: DataTypes.STRING(255), allowNull: true },
  accountPermission: { type: DataTypes.TEXT, allowNull: true },
  createdTime: { type: DataTypes.DATE, allowNull: true },
  lastLoginTime: { type: DataTypes.DATE, allowNull: true },
  mfaEnabled: { type: DataTypes.BOOLEAN, allowNull: true },
  accountStatus: { type: DataTypes.STRING(50), allowNull: true },
  customFields: { type: DataTypes.JSONB, allowNull: true },
  sourceRawData: { type: DataTypes.JSONB, allowNull: false },
  importBatchId: { type: DataTypes.STRING(64), allowNull: false },
  dataTier: { type: DataTypes.STRING(10), allowNull: false, defaultValue: DataTier.HOT },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'account_data',
  timestamps: false,
  indexes: [
    { fields: ['sourceId', 'dataTier'] },
    { fields: ['sourceId', 'importBatchId'] },
    { fields: ['accountId'] },
  ],
});

export default AccountData;
