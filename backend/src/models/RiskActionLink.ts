import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import { VerificationStatus } from './enums';

interface Attributes {
  id: string;
  riskId: string;
  actionId: string;
  isRequired: boolean;
  contributionDescription: string;
  verificationStatus: VerificationStatus;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  reviewComment: string | null;
  selfReview: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<Attributes,
  'id' | 'isRequired' | 'verificationStatus' | 'verifiedBy' | 'verifiedAt' |
  'reviewComment' | 'selfReview' | 'createdAt' | 'updatedAt'>;

class RiskActionLink extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare riskId: string;
  declare actionId: string;
  declare isRequired: boolean;
  declare contributionDescription: string;
  declare verificationStatus: VerificationStatus;
  declare verifiedBy: string | null;
  declare verifiedAt: Date | null;
  declare reviewComment: string | null;
  declare selfReview: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
}

RiskActionLink.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  riskId: { type: DataTypes.UUID, allowNull: false },
  actionId: { type: DataTypes.UUID, allowNull: false },
  isRequired: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  contributionDescription: { type: DataTypes.TEXT, allowNull: false },
  verificationStatus: { type: DataTypes.STRING(20), allowNull: false, defaultValue: VerificationStatus.PENDING },
  verifiedBy: { type: DataTypes.UUID, allowNull: true },
  verifiedAt: { type: DataTypes.DATE, allowNull: true },
  reviewComment: { type: DataTypes.TEXT, allowNull: true },
  selfReview: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'risk_action_links',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['riskId', 'actionId'] },
    { fields: ['actionId', 'verificationStatus'] },
  ],
});

export default RiskActionLink;
