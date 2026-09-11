import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

interface Attributes {
  id: string;
  taskId: string;
  auditorUserId: string;
  assignedBy: string;
  assignedAt: Date;
}

type CreationAttributes = Optional<Attributes, 'id' | 'assignedAt'>;

class AssessmentAuditor extends Model<Attributes, CreationAttributes> implements Attributes {
  declare id: string;
  declare taskId: string;
  declare auditorUserId: string;
  declare assignedBy: string;
  declare assignedAt: Date;
}

AssessmentAuditor.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  taskId: { type: DataTypes.UUID, allowNull: false },
  auditorUserId: { type: DataTypes.UUID, allowNull: false },
  assignedBy: { type: DataTypes.UUID, allowNull: false },
  assignedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'assessment_auditors',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['taskId', 'auditorUserId'] },
    { fields: ['auditorUserId', 'taskId'] },
  ],
});

export default AssessmentAuditor;
