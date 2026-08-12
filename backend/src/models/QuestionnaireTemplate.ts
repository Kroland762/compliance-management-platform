import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import User from './User';

interface QuestionnaireTemplateAttributes {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: Date;
  questionCount: number;
  standardSeriesKey: string;
  version: string;
  columnSchema: Array<Record<string, unknown>>;
}

type CreationAttributes = Optional<QuestionnaireTemplateAttributes,
  'id' | 'createdAt' | 'questionCount' | 'standardSeriesKey' | 'version' | 'columnSchema'>;

class QuestionnaireTemplate extends Model<QuestionnaireTemplateAttributes, CreationAttributes> implements QuestionnaireTemplateAttributes {
  declare id: string;
  declare name: string;
  declare description: string | null;
  declare createdBy: string;
  declare createdAt: Date;
  declare questionCount: number;
  declare standardSeriesKey: string;
  declare version: string;
  declare columnSchema: Array<Record<string, unknown>>;
}

QuestionnaireTemplate.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING(200), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.UUID, allowNull: false, references: { model: User, key: 'id' } },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    questionCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    standardSeriesKey: { type: DataTypes.STRING(120), allowNull: false, defaultValue: DataTypes.UUIDV4 },
    version: { type: DataTypes.STRING(50), allowNull: false, defaultValue: '1.0' },
    columnSchema: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  },
  { sequelize, tableName: 'questionnaire_templates', timestamps: false },
);

export default QuestionnaireTemplate;
