import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import { VerificationStatus } from './enums';

interface Attributes {
  id: string;
  findingId: string;
  actionId: string;
  isRequired: boolean;
  contributionDescription: string;
  verificationStatus: VerificationStatus;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  reviewComment: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<Attributes,
  'id' | 'isRequired' | 'verificationStatus' | 'verifiedBy' | 'verifiedAt' |
  'reviewComment' | 'createdAt' | 'updatedAt'>;

class FindingActionLink extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare findingId: string;
  declare actionId: string;
  declare isRequired: boolean;
  declare contributionDescription: string;
  declare verificationStatus: VerificationStatus;
  declare verifiedBy: string | null;
  declare verifiedAt: Date | null;
  declare reviewComment: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

FindingActionLink.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  findingId: { type: DataTypes.UUID, allowNull: false },
  actionId: { type: DataTypes.UUID, allowNull: false },
  isRequired: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  contributionDescription: { type: DataTypes.TEXT, allowNull: false },
  verificationStatus: { type: DataTypes.STRING(20), allowNull: false, defaultValue: VerificationStatus.PENDING },
  verifiedBy: { type: DataTypes.UUID, allowNull: true },
  verifiedAt: { type: DataTypes.DATE, allowNull: true },
  reviewComment: { type: DataTypes.TEXT, allowNull: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'finding_action_links',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['findingId', 'actionId'] },
    { fields: ['actionId', 'verificationStatus'] },
  ],
});

export default FindingActionLink;
