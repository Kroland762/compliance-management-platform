import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import { AssessmentType, RiskLevel, RemediationStatus, RiskStatus } from './enums';
import AuditTask from './AuditTask';
import QuestionItem from './QuestionItem';

interface RiskRecordAttributes {
  id: string;
  taskId: string | null;
  questionItemId: string | null;
  assessmentType: AssessmentType;
  assessmentTarget: string;
  riskIdentification: string;
  riskLevel: RiskLevel;
  remediationMeasures: string | null;
  remediationStatus: RemediationStatus;
  riskStatus: RiskStatus;
  identifiedAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<RiskRecordAttributes, 'id' | 'taskId' | 'questionItemId' | 'identifiedAt' | 'updatedAt' | 'remediationMeasures'>;

class RiskRecord extends Model<RiskRecordAttributes, CreationAttributes> implements RiskRecordAttributes {
  declare id: string;
  declare taskId: string | null;
  declare questionItemId: string | null;
  declare assessmentType: AssessmentType;
  declare assessmentTarget: string;
  declare riskIdentification: string;
  declare riskLevel: RiskLevel;
  declare remediationMeasures: string | null;
  declare remediationStatus: RemediationStatus;
  declare riskStatus: RiskStatus;
  declare identifiedAt: Date;
  declare updatedAt: Date;
}

RiskRecord.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    taskId: { type: DataTypes.UUID, allowNull: true, references: { model: AuditTask, key: 'id' } },
    questionItemId: { type: DataTypes.UUID, allowNull: true, references: { model: QuestionItem, key: 'id' } },
    assessmentType: { type: DataTypes.STRING(100), allowNull: false },
    assessmentTarget: { type: DataTypes.STRING(200), allowNull: false },
    riskIdentification: { type: DataTypes.STRING(100), allowNull: false },
    riskLevel: { type: DataTypes.ENUM(...Object.values(RiskLevel)), allowNull: false },
    remediationMeasures: { type: DataTypes.STRING(500), allowNull: true },
    remediationStatus: { type: DataTypes.ENUM(...Object.values(RemediationStatus)), allowNull: false, defaultValue: RemediationStatus.NOT_REMEDIATED },
    riskStatus: { type: DataTypes.ENUM(...Object.values(RiskStatus)), allowNull: false, defaultValue: RiskStatus.RISK_REDUCTION },
    identifiedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: 'risk_records', timestamps: false },
);

export default RiskRecord;
