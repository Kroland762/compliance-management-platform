import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

interface MemberInvitationAttributes {
  id: string;
  targetUserId: string;
  tokenHash: string;
  roleIds: string[];
  departments: Array<{ departmentId: string; isPrimary: boolean; positionTitle?: string | null }>;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdBy: string;
  createdAt: Date;
}

type CreationAttributes = Optional<MemberInvitationAttributes, 'id' | 'acceptedAt' | 'createdAt'>;

class MemberInvitation extends Model<MemberInvitationAttributes, CreationAttributes> implements MemberInvitationAttributes {
  declare id: string;
  declare targetUserId: string;
  declare tokenHash: string;
  declare roleIds: string[];
  declare departments: Array<{ departmentId: string; isPrimary: boolean; positionTitle?: string | null }>;
  declare expiresAt: Date;
  declare acceptedAt: Date | null;
  declare createdBy: string;
  declare createdAt: Date;
}

MemberInvitation.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  targetUserId: { type: DataTypes.UUID, allowNull: false },
  tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  roleIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  departments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  acceptedAt: { type: DataTypes.DATE, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: false },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'member_invitations',
  timestamps: false,
  indexes: [{ fields: ['targetUserId', 'expiresAt'] }],
});

export default MemberInvitation;
