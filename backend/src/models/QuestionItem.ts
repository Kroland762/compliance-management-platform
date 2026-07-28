import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import { AnswerStatus, ComplianceStatus, RiskLevel } from './enums';
import AuditTask from './AuditTask';
import QuestionTemplate from './QuestionTemplate';

interface QuestionItemAttributes {
  id: string;
  taskId: string;
  templateQuestionId: string;
  sequenceNumber: string;
  controlDomain: string;
  controlPoint: string;
  referenceAnswer: string | null;
  historicalEvidencePath: string | null;
  responsibleDepartment: string | null;
  responsiblePerson: string | null;
  currentStatusDescription: string | null;
  answerStatus: AnswerStatus;
  complianceStatus: ComplianceStatus | null;
  riskIdentification: string | null;
  riskLevel: RiskLevel | null;
  assignedTo: string | null;
  remediationMeasures: string | null;
  answeredAt: Date | null;
  reviewedAt: Date | null;
}

type CreationAttributes = Optional<QuestionItemAttributes, 'id' | 'currentStatusDescription' | 'complianceStatus' | 'riskIdentification' | 'riskLevel' | 'remediationMeasures' | 'answeredAt' | 'reviewedAt'>;

class QuestionItem extends Model<QuestionItemAttributes, CreationAttributes> implements QuestionItemAttributes {
  declare id: string;
  declare taskId: string;
  declare templateQuestionId: string;
  declare sequenceNumber: string;
  declare controlDomain: string;
  declare controlPoint: string;
  declare referenceAnswer: string | null;
  declare historicalEvidencePath: string | null;
  declare responsibleDepartment: string | null;
  declare responsiblePerson: string | null;
  declare currentStatusDescription: string | null;
  declare answerStatus: AnswerStatus;
  declare complianceStatus: ComplianceStatus | null;
  declare riskIdentification: string | null;
  declare riskLevel: RiskLevel | null;
  declare remediationMeasures: string | null;
  declare assignedTo: string | null;
  declare answeredAt: Date | null;
  declare reviewedAt: Date | null;
}

QuestionItem.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    taskId: { type: DataTypes.UUID, allowNull: false, references: { model: AuditTask, key: 'id' } },
    templateQuestionId: { type: DataTypes.UUID, allowNull: false, references: { model: QuestionTemplate, key: 'id' } },
    sequenceNumber: { type: DataTypes.STRING(50), allowNull: false },
    controlDomain: { type: DataTypes.STRING(200), allowNull: false },
    controlPoint: { type: DataTypes.TEXT, allowNull: false },
    referenceAnswer: { type: DataTypes.TEXT, allowNull: true },
    historicalEvidencePath: { type: DataTypes.STRING(500), allowNull: true },
    responsibleDepartment: { type: DataTypes.STRING(100), allowNull: true },
    responsiblePerson: { type: DataTypes.STRING(100), allowNull: true },
    currentStatusDescription: { type: DataTypes.STRING(500), allowNull: true },
    answerStatus: { type: DataTypes.STRING(30), allowNull: false, defaultValue: AnswerStatus.PENDING, validate: { isIn: [Object.values(AnswerStatus)] } },
    complianceStatus: { type: DataTypes.STRING(30), allowNull: true, validate: { isIn: [Object.values(ComplianceStatus)] } },
    riskIdentification: { type: DataTypes.STRING(100), allowNull: true },
    riskLevel: { type: DataTypes.STRING(20), allowNull: true, validate: { isIn: [Object.values(RiskLevel)] } },
    remediationMeasures: { type: DataTypes.STRING(500), allowNull: true },
    assignedTo: { type: DataTypes.UUID, allowNull: true },
    answeredAt: { type: DataTypes.DATE, allowNull: true },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, tableName: 'question_items', timestamps: false },
);

export default QuestionItem;
