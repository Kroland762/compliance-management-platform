import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../../config/database';

export enum RuleType {
  BUILTIN = 'BUILTIN',
  CUSTOM = 'CUSTOM',
}

export enum Severity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum BuiltinKey {
  LONG_INACTIVE = 'LONG_INACTIVE',
  NO_MFA = 'NO_MFA',
  HIGH_PRIV_NO_MFA = 'HIGH_PRIV_NO_MFA',
  ABNORMAL_CREATE_TIME = 'ABNORMAL_CREATE_TIME',
}

interface AuditRuleAttributes {
  id: string;
  name: string;
  ruleType: RuleType;
  description: string | null;
  severity: Severity;
  conditionLogic: object;
  isActive: boolean;
  builtinKey: string | null;
  paramsConfig: object | null;
  createdAt: Date;
  updatedAt: Date;
}

type CreationAttributes = Optional<AuditRuleAttributes, 'id' | 'createdAt' | 'updatedAt' | 'description' | 'builtinKey' | 'paramsConfig'>;

class AuditRule extends Model<AuditRuleAttributes, CreationAttributes> implements AuditRuleAttributes {
  declare id: string;
  declare name: string;
  declare ruleType: RuleType;
  declare description: string | null;
  declare severity: Severity;
  declare conditionLogic: object;
  declare isActive: boolean;
  declare builtinKey: string | null;
  declare paramsConfig: object | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

AuditRule.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  ruleType: { type: DataTypes.STRING(20), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  severity: { type: DataTypes.STRING(20), allowNull: false },
  conditionLogic: { type: DataTypes.JSONB, allowNull: false },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  builtinKey: { type: DataTypes.STRING(100), allowNull: true, unique: true },
  paramsConfig: { type: DataTypes.JSONB, allowNull: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'account_audit_rules',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

export default AuditRule;
