import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

interface MemberRoleAttributes {
  id: string;
  memberId: string;
  roleId: string;
  createdAt: Date;
}

type CreationAttributes = Optional<MemberRoleAttributes, 'id' | 'createdAt'>;

class MemberRole extends Model<MemberRoleAttributes, CreationAttributes> implements MemberRoleAttributes {
  declare id: string;
  declare memberId: string;
  declare roleId: string;
  declare createdAt: Date;
}

MemberRole.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  memberId: { type: DataTypes.UUID, allowNull: false },
  roleId: { type: DataTypes.UUID, allowNull: false },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'member_roles',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['memberId', 'roleId'] },
    { fields: ['roleId'] },
  ],
});

export default MemberRole;
