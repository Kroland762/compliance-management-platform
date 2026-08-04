import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import QuestionItem from './QuestionItem';
import User from './User';
import { EvidenceScanStatus, EvidenceStatus, EvidenceType } from './enums';

interface EvidenceFileAttributes {
  id: string;
  questionItemId: string;
  evidenceType: EvidenceType;
  version: number;
  sha256: string | null;
  scanStatus: EvidenceScanStatus;
  status: EvidenceStatus;
  isLocked: boolean;
  supersedesId: string | null;
  originalFilename: string;
  storedFilename: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  uploadedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
}

type CreationAttributes = Optional<EvidenceFileAttributes, 'id' | 'evidenceType' | 'version' | 'sha256' | 'scanStatus' | 'status' | 'isLocked' | 'supersedesId' | 'uploadedAt' | 'deletedAt' | 'deletedBy'>;

class EvidenceFile extends Model<EvidenceFileAttributes, CreationAttributes> implements EvidenceFileAttributes {
  declare id: string;
  declare questionItemId: string;
  declare evidenceType: EvidenceType;
  declare version: number;
  declare sha256: string | null;
  declare scanStatus: EvidenceScanStatus;
  declare status: EvidenceStatus;
  declare isLocked: boolean;
  declare supersedesId: string | null;
  declare originalFilename: string;
  declare storedFilename: string;
  declare filePath: string;
  declare fileSize: number;
  declare mimeType: string;
  declare uploadedBy: string;
  declare uploadedAt: Date;
  declare deletedAt: Date | null;
  declare deletedBy: string | null;
}

EvidenceFile.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    questionItemId: { type: DataTypes.UUID, allowNull: false, references: { model: QuestionItem, key: 'id' } },
    evidenceType: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: EvidenceType.CURRENT,
      validate: { isIn: [Object.values(EvidenceType)] },
    },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, validate: { min: 1 } },
    sha256: { type: DataTypes.STRING(64), allowNull: true },
    scanStatus: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: EvidenceScanStatus.PENDING,
      validate: { isIn: [Object.values(EvidenceScanStatus)] },
    },
    status: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: EvidenceStatus.ACTIVE,
      validate: { isIn: [Object.values(EvidenceStatus)] },
    },
    isLocked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    supersedesId: { type: DataTypes.UUID, allowNull: true },
    originalFilename: { type: DataTypes.STRING(255), allowNull: false },
    storedFilename: { type: DataTypes.STRING(255), allowNull: false },
    filePath: { type: DataTypes.STRING(500), allowNull: false },
    fileSize: { type: DataTypes.INTEGER, allowNull: false },
    mimeType: { type: DataTypes.STRING(100), allowNull: false },
    uploadedBy: { type: DataTypes.UUID, allowNull: false, references: { model: User, key: 'id' } },
    uploadedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    deletedAt: { type: DataTypes.DATE, allowNull: true },
    deletedBy: { type: DataTypes.UUID, allowNull: true },
  },
  {
    sequelize,
    tableName: 'evidence_files',
    timestamps: false,
    indexes: [
      { fields: ['questionItemId', 'evidenceType', 'status'] },
      { name: 'idx_evidence_files_question_type_version', fields: ['questionItemId', 'evidenceType', 'version'] },
      { fields: ['sha256'] },
    ],
  },
);

export default EvidenceFile;
