import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import { AssessmentType, TaskStatus } from './enums';
import User from './User';
import QuestionnaireTemplate from './QuestionnaireTemplate';

interface AuditTaskAttributes {
  id: string;
  name: string;
  templateId: string;
  assessmentType: AssessmentType;
  assessmentTarget: string;
  createdBy: string;
  assignedTo: string | null;
  reviewerId: string | null;
  departmentId: string;
  status: TaskStatus;
  returnReason: string | null;
  returnedAssignees: string[] | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  publishedAt: Date | null;
  cancelledAt: Date | null;
  lockVersion: number;
  createdAt: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  columnSchemaSnapshot: Array<Record<string, unknown>>;
}

type CreationAttributes = Optional<AuditTaskAttributes,
  'id' | 'name' | 'createdAt' | 'submittedAt' | 'reviewedAt' | 'returnReason' |
  'returnedAssignees' | 'assignedTo' | 'reviewerId' | 'periodStart' | 'periodEnd' |
  'publishedAt' | 'cancelledAt' | 'lockVersion' | 'columnSchemaSnapshot'>;

class AuditTask extends Model<AuditTaskAttributes, CreationAttributes> implements AuditTaskAttributes {
  declare id: string;
  declare name: string;
  declare templateId: string;
  declare assessmentType: AssessmentType;
  declare assessmentTarget: string;
  declare createdBy: string;
  declare assignedTo: string | null;
  declare reviewerId: string | null;
  declare departmentId: string;
  declare status: TaskStatus;
  declare returnReason: string | null;
  declare returnedAssignees: string[] | null;
  declare periodStart: Date | null;
  declare periodEnd: Date | null;
  declare publishedAt: Date | null;
  declare cancelledAt: Date | null;
  declare lockVersion: number;
  declare createdAt: Date;
  declare submittedAt: Date | null;
  declare reviewedAt: Date | null;
  declare columnSchemaSnapshot: Array<Record<string, unknown>>;
}

AuditTask.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING(200), allowNull: false, defaultValue: '' },
    templateId: { type: DataTypes.UUID, allowNull: false, references: { model: QuestionnaireTemplate, key: 'id' } },
    assessmentType: { type: DataTypes.STRING(100), allowNull: false },
    assessmentTarget: { type: DataTypes.STRING(200), allowNull: false },
    createdBy: { type: DataTypes.UUID, allowNull: false, references: { model: User, key: 'id' } },
    assignedTo: { type: DataTypes.UUID, allowNull: true, references: { model: User, key: 'id' } },
    reviewerId: { type: DataTypes.UUID, allowNull: true, references: { model: User, key: 'id' } },
    departmentId: { type: DataTypes.UUID, allowNull: false },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: TaskStatus.PREPARING, validate: { isIn: [Object.values(TaskStatus)] } },
    returnReason: { type: DataTypes.TEXT, allowNull: true },
    returnedAssignees: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
    periodStart: { type: DataTypes.DATEONLY, allowNull: true },
    periodEnd: { type: DataTypes.DATEONLY, allowNull: true },
    publishedAt: { type: DataTypes.DATE, allowNull: true },
    cancelledAt: { type: DataTypes.DATE, allowNull: true },
    lockVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    submittedAt: { type: DataTypes.DATE, allowNull: true },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
    columnSchemaSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  },
  { sequelize, tableName: 'audit_tasks', timestamps: false },
);

export default AuditTask;
