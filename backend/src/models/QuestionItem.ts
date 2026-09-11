import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import {
  AnswerStatus,
  ComplianceStatus,
  EvaluationWorkflowStatus,
} from './enums';
import AuditTask from './AuditTask';
import QuestionTemplate from './QuestionTemplate';

interface QuestionItemAttributes {
  id: string;
  taskId: string;
  templateQuestionId: string;
  assetId: string | null;
  sequenceNumber: string;
  controlDomain: string;
  controlPoint: string;
  referenceAnswer: string | null;
  historicalEvidencePath: string | null;
  responsibleDepartment: string | null;
  responsiblePerson: string | null;
  responsibleDepartmentId: string;
  currentStatusDescription: string | null;
  answerStatus: AnswerStatus;
  workflowStatus: EvaluationWorkflowStatus;
  complianceStatus: ComplianceStatus;
  assignedTo: string | null;
  reviewedBy: string | null;
  reviewClaimedBy: string | null;
  reviewClaimedAt: Date | null;
  answeredAt: Date | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  lockVersion: number;
  controlKey: string | null;
  templateDataSnapshot: Record<string, unknown>;
}

type CreationAttributes = Optional<QuestionItemAttributes,
  'id' | 'currentStatusDescription' |
  'workflowStatus' | 'complianceStatus' | 'assignedTo' | 'reviewedBy' | 'answeredAt' |
  'reviewClaimedBy' | 'reviewClaimedAt' | 'submittedAt' | 'reviewedAt' | 'lockVersion' |
  'controlKey' | 'templateDataSnapshot'>;

class QuestionItem extends Model<QuestionItemAttributes, CreationAttributes> implements QuestionItemAttributes {
  declare id: string;
  declare taskId: string;
  declare templateQuestionId: string;
  declare assetId: string | null;
  declare sequenceNumber: string;
  declare controlDomain: string;
  declare controlPoint: string;
  declare referenceAnswer: string | null;
  declare historicalEvidencePath: string | null;
  declare responsibleDepartment: string | null;
  declare responsiblePerson: string | null;
  declare responsibleDepartmentId: string;
  declare currentStatusDescription: string | null;
  declare answerStatus: AnswerStatus;
  declare workflowStatus: EvaluationWorkflowStatus;
  declare complianceStatus: ComplianceStatus;
  declare assignedTo: string | null;
  declare reviewedBy: string | null;
  declare reviewClaimedBy: string | null;
  declare reviewClaimedAt: Date | null;
  declare answeredAt: Date | null;
  declare submittedAt: Date | null;
  declare reviewedAt: Date | null;
  declare lockVersion: number;
  declare controlKey: string | null;
  declare templateDataSnapshot: Record<string, unknown>;
}

QuestionItem.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    taskId: { type: DataTypes.UUID, allowNull: false, references: { model: AuditTask, key: 'id' } },
    templateQuestionId: { type: DataTypes.UUID, allowNull: false, references: { model: QuestionTemplate, key: 'id' } },
    assetId: { type: DataTypes.UUID, allowNull: true },
    sequenceNumber: { type: DataTypes.STRING(50), allowNull: false },
    controlDomain: { type: DataTypes.STRING(200), allowNull: false },
    controlPoint: { type: DataTypes.TEXT, allowNull: false },
    referenceAnswer: { type: DataTypes.TEXT, allowNull: true },
    historicalEvidencePath: { type: DataTypes.STRING(500), allowNull: true },
    responsibleDepartment: { type: DataTypes.STRING(100), allowNull: true },
    responsiblePerson: { type: DataTypes.STRING(100), allowNull: true },
    responsibleDepartmentId: { type: DataTypes.UUID, allowNull: false },
    currentStatusDescription: { type: DataTypes.TEXT, allowNull: true },
    answerStatus: { type: DataTypes.STRING(30), allowNull: false, defaultValue: AnswerStatus.PENDING, validate: { isIn: [Object.values(AnswerStatus)] } },
    workflowStatus: { type: DataTypes.STRING(30), allowNull: false, defaultValue: EvaluationWorkflowStatus.PENDING, validate: { isIn: [Object.values(EvaluationWorkflowStatus)] } },
    complianceStatus: { type: DataTypes.STRING(30), allowNull: false, defaultValue: ComplianceStatus.NOT_ASSESSED, validate: { isIn: [Object.values(ComplianceStatus)] } },
    assignedTo: { type: DataTypes.UUID, allowNull: true },
    reviewedBy: { type: DataTypes.UUID, allowNull: true },
    reviewClaimedBy: { type: DataTypes.UUID, allowNull: true },
    reviewClaimedAt: { type: DataTypes.DATE, allowNull: true },
    answeredAt: { type: DataTypes.DATE, allowNull: true },
    submittedAt: { type: DataTypes.DATE, allowNull: true },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
    lockVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    controlKey: { type: DataTypes.STRING(120), allowNull: true },
    templateDataSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  },
  {
    sequelize,
    tableName: 'question_items',
    timestamps: false,
    indexes: [
      { fields: ['assetId'] },
      { name: 'question_items_task_sequence_idx', fields: ['taskId', 'sequenceNumber', 'id'] },
      { name: 'question_items_task_status_idx', fields: ['taskId', 'workflowStatus', 'complianceStatus'] },
      { fields: ['assignedTo', 'workflowStatus'] },
      { fields: ['reviewClaimedBy', 'workflowStatus'] },
      { fields: ['responsibleDepartmentId'] },
    ],
  },
);

export default QuestionItem;
