import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import QuestionItem from './QuestionItem';
import User from './User';

interface EvidenceFileAttributes {
  id: string;
  questionItemId: string;
  originalFilename: string;
  storedFilename: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  uploadedAt: Date;
}

type CreationAttributes = Optional<EvidenceFileAttributes, 'id' | 'uploadedAt'>;

class EvidenceFile extends Model<EvidenceFileAttributes, CreationAttributes> implements EvidenceFileAttributes {
  declare id: string;
  declare questionItemId: string;
  declare originalFilename: string;
  declare storedFilename: string;
  declare filePath: string;
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
    storedFilename: { type: DataTypes.STRING(255), allowNull: false },
    filePath: { type: DataTypes.STRING(500), allowNull: false },
    fileSize: { type: DataTypes.INTEGER, allowNull: false },
    mimeType: { type: DataTypes.STRING(100), allowNull: false },
    uploadedBy: { type: DataTypes.UUID, allowNull: false, references: { model: User, key: 'id' } },
    uploadedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: 'evidence_files', timestamps: false },
);

export default EvidenceFile;
