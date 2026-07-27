import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import QuestionItem from './QuestionItem';
import User from './User';

interface EvidenceFileAttributes {
  id: string;
  questionItemId: string;
  originalFilename: string;
  storedFilename: string | null;
  filePath: string | null;
  storageKey: string | null;
  sha256: string | null;
  status: 'active' | 'deleted' | 'quarantined';
  deletedAt: Date | null;
  evidenceType: 'current' | 'historical';
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  uploadedAt: Date;
}

type CreationAttributes = Optional<EvidenceFileAttributes, 'id' | 'storedFilename' | 'filePath' | 'storageKey' | 'sha256' | 'status' | 'deletedAt' | 'evidenceType' | 'uploadedAt'>;

class EvidenceFile extends Model<EvidenceFileAttributes, CreationAttributes> implements EvidenceFileAttributes {
  declare id: string;
  declare questionItemId: string;
  declare originalFilename: string;
  declare storedFilename: string | null;
  declare filePath: string | null;
  declare storageKey: string | null;
  declare sha256: string | null;
  declare status: 'active' | 'deleted' | 'quarantined';
  declare deletedAt: Date | null;
  declare evidenceType: 'current' | 'historical';
  declare fileSize: number;
  declare mimeType: string;
  declare uploadedBy: string;
  declare uploadedAt: Date;
}

EvidenceFile.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    questionItemId: { type: DataTypes.UUID, allowNull: false, references: { model: QuestionItem, key: 'id' } },
    originalFilename: { type: DataTypes.STRING(255), allowNull: false },
    storedFilename: { type: DataTypes.STRING(255), allowNull: true },
    filePath: { type: DataTypes.STRING(500), allowNull: true },
    storageKey: { type: DataTypes.STRING(500), allowNull: true },
    sha256: { type: DataTypes.STRING(64), allowNull: true },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active' },
    deletedAt: { type: DataTypes.DATE, allowNull: true },
    evidenceType: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'current' },
    fileSize: { type: DataTypes.INTEGER, allowNull: false },
    mimeType: { type: DataTypes.STRING(100), allowNull: false },
    uploadedBy: { type: DataTypes.UUID, allowNull: false, references: { model: User, key: 'id' } },
    uploadedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: 'evidence_files', timestamps: false },
);

export default EvidenceFile;
