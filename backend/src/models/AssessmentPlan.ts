import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

interface Attributes {
  id: string;
  name: string;
  templateId: string;
  assessmentType: string;
  defaultDepartmentId: string;
  cronExpression: string;
  timeZone: string;
  scopeSnapshot: Array<Record<string, unknown>>;
  matrixSnapshot: Array<Record<string, unknown>>;
  enabled: boolean;
  nextRunAt: Date | null;
  createdBy: string;
  lockVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<Attributes,
  'id' | 'timeZone' | 'scopeSnapshot' | 'matrixSnapshot' | 'enabled' | 'nextRunAt' |
  'lockVersion' | 'createdAt' | 'updatedAt'>;

class AssessmentPlan extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare name: string;
  declare templateId: string;
  declare assessmentType: string;
  declare defaultDepartmentId: string;
  declare cronExpression: string;
  declare timeZone: string;
  declare scopeSnapshot: Array<Record<string, unknown>>;
  declare matrixSnapshot: Array<Record<string, unknown>>;
  declare enabled: boolean;
  declare nextRunAt: Date | null;
  declare createdBy: string;
  declare lockVersion: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

AssessmentPlan.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(200), allowNull: false },
  templateId: { type: DataTypes.UUID, allowNull: false },
  assessmentType: { type: DataTypes.STRING(100), allowNull: false },
  defaultDepartmentId: { type: DataTypes.UUID, allowNull: false },
  cronExpression: { type: DataTypes.STRING(120), allowNull: false },
  timeZone: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'Asia/Shanghai' },
  scopeSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  matrixSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  nextRunAt: { type: DataTypes.DATE, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: false },
  lockVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'assessment_plans',
  timestamps: true,
  indexes: [
    { fields: ['enabled', 'nextRunAt'] },
    { fields: ['templateId'] },
  ],
});

export default AssessmentPlan;
