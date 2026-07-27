import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

export enum QualificationStatus {
  VALID = 'valid',
  EXPIRING = 'expiring',
  EXPIRED = 'expired',
  MISSING = 'missing',
}

interface QualificationAttributes {
  id: string;
  name: string;
  category: string;
  certificateNo: string | null;
  issuer: string | null;
  ownerCompany: string | null;
  ownerDepartment: string | null;
  responsiblePerson: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  attachmentUrl: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<
  QualificationAttributes,
  'id' | 'certificateNo' | 'issuer' | 'ownerCompany' | 'ownerDepartment' | 'responsiblePerson' |
  'issueDate' | 'expiryDate' | 'attachmentUrl' | 'notes' | 'createdBy' | 'createdAt' | 'updatedAt'
>;

class Qualification extends Model<QualificationAttributes, CreationAttributes> implements QualificationAttributes {
  declare id: string;
  declare name: string;
  declare category: string;
  declare certificateNo: string | null;
  declare issuer: string | null;
  declare ownerCompany: string | null;
  declare ownerDepartment: string | null;
  declare responsiblePerson: string | null;
  declare issueDate: string | null;
  declare expiryDate: string | null;
  declare attachmentUrl: string | null;
  declare notes: string | null;
  declare createdBy: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Qualification.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(200), allowNull: false },
  category: { type: DataTypes.STRING(100), allowNull: false },
  certificateNo: { type: DataTypes.STRING(120), allowNull: true },
  issuer: { type: DataTypes.STRING(200), allowNull: true },
  ownerCompany: { type: DataTypes.STRING(150), allowNull: true },
  ownerDepartment: { type: DataTypes.STRING(100), allowNull: true },
  responsiblePerson: { type: DataTypes.STRING(100), allowNull: true },
  issueDate: { type: DataTypes.DATEONLY, allowNull: true },
  expiryDate: { type: DataTypes.DATEONLY, allowNull: true },
  attachmentUrl: { type: DataTypes.STRING(500), allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'qualifications',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  indexes: [
    { fields: ['category'] },
    { fields: ['ownerCompany'] },
    { fields: ['ownerDepartment'] },
    { fields: ['expiryDate'] },
  ],
});

export default Qualification;
