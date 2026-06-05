import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import { AssessmentType, TaskStatus } from './enums';
import User from './User';
import QuestionnaireTemplate from './QuestionnaireTemplate';

interface AuditTaskAttributes {
  id: string;
  templateId: string;
  assessmentType: AssessmentType;
  assessmentTarget: string;
  createdBy: string;
  assignedTo: string | null;
  reviewerId: string | null;
  status: TaskStatus;
  returnReason: string | null;
  returnedAssignees: string[] | null;
  createdAt: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
}

type CreationAttributes = Optional<AuditTaskAttributes, 'id' | 'createdAt' | 'submittedAt' | 'reviewedAt' | 'returnReason' | 'returnedAssignees' | 'assignedTo' | 'reviewerId'>;

class AuditTask extends Model<AuditTaskAttributes, CreationAttributes> implements AuditTaskAttributes {
  declare id: string;
  declare templateId: string;
  declare assessmentType: AssessmentType;
  declare assessmentTarget: string;
  declare createdBy: string;
  declare assignedTo: string | null;
  declare reviewerId: string | null;
  declare status: TaskStatus;
  declare returnReason: string | null;
  declare returnedAssignees: string[] | null;
  declare createdAt: Date;
  declare submittedAt: Date | null;
  declare reviewedAt: Date | null;
}

AuditTask.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    templateId: { type: DataTypes.UUID, allowNull: false, references: { model: QuestionnaireTemplate, key: 'id' } },
    assessmentType: { type: DataTypes.STRING(100), allowNull: false },
    assessmentTarget: { type: DataTypes.STRING(200), allowNull: false },
    createdBy: { type: DataTypes.UUID, allowNull: false, references: { model: User, key: 'id' } },
    assignedTo: { type: DataTypes.UUID, allowNull: true, references: { model: User, key: 'id' } },
    reviewerId: { type: DataTypes.UUID, allowNull: true, references: { model: User, key: 'id' } },
    status: { type: DataTypes.ENUM(...Object.values(TaskStatus)), allowNull: false, defaultValue: TaskStatus.DRAFT },
    returnReason: { type: DataTypes.TEXT, allowNull: true },
    returnedAssignees: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    submittedAt: { type: DataTypes.DATE, allowNull: true },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, tableName: 'audit_tasks', timestamps: false },
);

export default AuditTask;
