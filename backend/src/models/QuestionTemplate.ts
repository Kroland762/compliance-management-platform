import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import QuestionnaireTemplate from './QuestionnaireTemplate';

interface QuestionTemplateAttributes {
  id: string;
  templateId: string;
  sequenceNumber: string;
  controlDomain: string;
  controlPoint: string;
  referenceAnswer: string | null;
  historicalEvidencePath: string | null;
  responsibleDepartment: string | null;
  responsiblePerson: string | null;
  extraData: object | null;
}

type CreationAttributes = Optional<QuestionTemplateAttributes, 'id'>;

class QuestionTemplate extends Model<QuestionTemplateAttributes, CreationAttributes> implements QuestionTemplateAttributes {
  declare id: string;
  declare templateId: string;
  declare sequenceNumber: string;
  declare controlDomain: string;
  declare controlPoint: string;
  declare referenceAnswer: string | null;
  declare historicalEvidencePath: string | null;
  declare responsibleDepartment: string | null;
  declare responsiblePerson: string | null;
  declare extraData: object | null;
}

QuestionTemplate.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    templateId: { type: DataTypes.UUID, allowNull: false, references: { model: QuestionnaireTemplate, key: 'id' } },
    sequenceNumber: { type: DataTypes.STRING(50), allowNull: false },
    controlDomain: { type: DataTypes.STRING(200), allowNull: false },
    controlPoint: { type: DataTypes.TEXT, allowNull: false },
    referenceAnswer: { type: DataTypes.TEXT, allowNull: true },
    historicalEvidencePath: { type: DataTypes.STRING(500), allowNull: true },
    responsibleDepartment: { type: DataTypes.STRING(100), allowNull: true },
    responsiblePerson: { type: DataTypes.STRING(100), allowNull: true },
    extraData: { type: DataTypes.JSONB, allowNull: true },
  },
  { sequelize, tableName: 'question_templates', timestamps: false },
);

export default QuestionTemplate;
