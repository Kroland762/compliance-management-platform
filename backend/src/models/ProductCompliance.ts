import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';

export type ProductRecordStatus = 'active' | 'archived';
export type ProductTypeStatus = 'active' | 'retired';
export type ProductQuestionnaireStatus = 'draft' | 'active' | 'retired';
export type ProductQuestionType = 'boolean' | 'single_select' | 'multi_select' | 'short_text' | 'long_text' | 'number' | 'date';
export type DossierLifecycleStatus = 'draft' | 'pending_review' | 'changes_requested' | 'confirmed' | 'superseded';
export type DossierComplianceConclusion = 'not_assessed' | 'compliant' | 'conditionally_compliant' | 'non_compliant';
export type DossierAssignmentSource = 'rule' | 'manual';
export type DossierInheritanceStatus = 'new' | 'inherited' | 'modified' | 'unanswered';

interface ProductTypeAttributes {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: ProductTypeStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
type ProductTypeCreation = Optional<ProductTypeAttributes, 'id' | 'description' | 'status' | 'createdAt' | 'updatedAt'>;
export class ProductType extends Model<ProductTypeAttributes, ProductTypeCreation> implements ProductTypeAttributes {
  declare id: string;
  declare code: string;
  declare name: string;
  declare description: string | null;
  declare status: ProductTypeStatus;
  declare createdBy: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}
ProductType.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  code: { type: DataTypes.STRING(64), allowNull: false },
  name: { type: DataTypes.STRING(120), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active', validate: { isIn: [['active', 'retired']] } },
  createdBy: { type: DataTypes.UUID, allowNull: false },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { sequelize, tableName: 'product_types', timestamps: true, indexes: [{ unique: true, fields: ['code'] }, { fields: ['status'] }] });

interface ProductAttributes {
  id: string;
  code: string;
  name: string;
  defaultProductTypeId: string;
  ownerUserId: string;
  ownerDepartmentId: string;
  description: string | null;
  status: ProductRecordStatus;
  archivedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
type ProductCreation = Optional<ProductAttributes, 'id' | 'description' | 'status' | 'archivedAt' | 'createdAt' | 'updatedAt'>;
export class Product extends Model<ProductAttributes, ProductCreation> implements ProductAttributes {
  declare id: string;
  declare code: string;
  declare name: string;
  declare defaultProductTypeId: string;
  declare ownerUserId: string;
  declare ownerDepartmentId: string;
  declare description: string | null;
  declare status: ProductRecordStatus;
  declare archivedAt: Date | null;
  declare createdBy: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}
Product.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  code: { type: DataTypes.STRING(64), allowNull: false },
  name: { type: DataTypes.STRING(200), allowNull: false },
  defaultProductTypeId: { type: DataTypes.UUID, allowNull: false },
  ownerUserId: { type: DataTypes.UUID, allowNull: false },
  ownerDepartmentId: { type: DataTypes.UUID, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active', validate: { isIn: [['active', 'archived']] } },
  archivedAt: { type: DataTypes.DATE, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: false },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { sequelize, tableName: 'products', timestamps: true, indexes: [{ unique: true, fields: ['code'] }, { fields: ['ownerUserId', 'status'] }, { fields: ['ownerDepartmentId', 'status'] }] });

interface ProductVersionAttributes {
  id: string;
  productId: string;
  version: string;
  productTypeId: string;
  platforms: string[];
  usageScope: string;
  plannedReleaseDate: Date | null;
  actualReleaseDate: Date | null;
  changeDeclaration: Record<string, unknown>;
  createdBy: string;
  createdAt: Date;
}
type ProductVersionCreation = Optional<ProductVersionAttributes, 'id' | 'platforms' | 'plannedReleaseDate' | 'actualReleaseDate' | 'changeDeclaration' | 'createdAt'>;
export class ProductVersion extends Model<ProductVersionAttributes, ProductVersionCreation> implements ProductVersionAttributes {
  declare id: string;
  declare productId: string;
  declare version: string;
  declare productTypeId: string;
  declare platforms: string[];
  declare usageScope: string;
  declare plannedReleaseDate: Date | null;
  declare actualReleaseDate: Date | null;
  declare changeDeclaration: Record<string, unknown>;
  declare createdBy: string;
  declare createdAt: Date;
}
ProductVersion.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  productId: { type: DataTypes.UUID, allowNull: false },
  version: { type: DataTypes.STRING(80), allowNull: false },
  productTypeId: { type: DataTypes.UUID, allowNull: false },
  platforms: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  usageScope: { type: DataTypes.TEXT, allowNull: false },
  plannedReleaseDate: { type: DataTypes.DATEONLY, allowNull: true },
  actualReleaseDate: { type: DataTypes.DATEONLY, allowNull: true },
  changeDeclaration: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  createdBy: { type: DataTypes.UUID, allowNull: false },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { sequelize, tableName: 'product_versions', timestamps: false, indexes: [{ unique: true, fields: ['productId', 'version'] }, { fields: ['productTypeId'] }] });

interface DossierAttributes {
  id: string;
  productVersionId: string;
  revisionNumber: number;
  lifecycleStatus: DossierLifecycleStatus;
  complianceConclusion: DossierComplianceConclusion;
  proposedConclusion: DossierComplianceConclusion | null;
  sourceDossierId: string | null;
  supersedesDossierId: string | null;
  permissionsDeclared: boolean | null;
  personalDataDeclared: boolean | null;
  submittedBy: string | null;
  submittedAt: Date | null;
  reviewerId: string | null;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  returnReason: string | null;
  lockVersion: number;
  isCurrentConfirmed: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
type DossierCreation = Optional<DossierAttributes,
  'id' | 'revisionNumber' | 'lifecycleStatus' | 'complianceConclusion' | 'proposedConclusion' |
  'sourceDossierId' | 'supersedesDossierId' | 'permissionsDeclared' | 'personalDataDeclared' |
  'submittedBy' | 'submittedAt' | 'reviewerId' | 'confirmedBy' | 'confirmedAt' | 'returnReason' |
  'lockVersion' | 'isCurrentConfirmed' | 'createdAt' | 'updatedAt'>;
export class ProductComplianceDossier extends Model<DossierAttributes, DossierCreation> implements DossierAttributes {
  declare id: string;
  declare productVersionId: string;
  declare revisionNumber: number;
  declare lifecycleStatus: DossierLifecycleStatus;
  declare complianceConclusion: DossierComplianceConclusion;
  declare proposedConclusion: DossierComplianceConclusion | null;
  declare sourceDossierId: string | null;
  declare supersedesDossierId: string | null;
  declare permissionsDeclared: boolean | null;
  declare personalDataDeclared: boolean | null;
  declare submittedBy: string | null;
  declare submittedAt: Date | null;
  declare reviewerId: string | null;
  declare confirmedBy: string | null;
  declare confirmedAt: Date | null;
  declare returnReason: string | null;
  declare lockVersion: number;
  declare isCurrentConfirmed: boolean;
  declare createdBy: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}
ProductComplianceDossier.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  productVersionId: { type: DataTypes.UUID, allowNull: false },
  revisionNumber: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  lifecycleStatus: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'draft', validate: { isIn: [['draft', 'pending_review', 'changes_requested', 'confirmed', 'superseded']] } },
  complianceConclusion: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'not_assessed', validate: { isIn: [['not_assessed', 'compliant', 'conditionally_compliant', 'non_compliant']] } },
  proposedConclusion: { type: DataTypes.STRING(40), allowNull: true, validate: { isIn: [['not_assessed', 'compliant', 'conditionally_compliant', 'non_compliant']] } },
  sourceDossierId: { type: DataTypes.UUID, allowNull: true },
  supersedesDossierId: { type: DataTypes.UUID, allowNull: true },
  permissionsDeclared: { type: DataTypes.BOOLEAN, allowNull: true },
  personalDataDeclared: { type: DataTypes.BOOLEAN, allowNull: true },
  submittedBy: { type: DataTypes.UUID, allowNull: true },
  submittedAt: { type: DataTypes.DATE, allowNull: true },
  reviewerId: { type: DataTypes.UUID, allowNull: true },
  confirmedBy: { type: DataTypes.UUID, allowNull: true },
  confirmedAt: { type: DataTypes.DATE, allowNull: true },
  returnReason: { type: DataTypes.TEXT, allowNull: true },
  lockVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  isCurrentConfirmed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  createdBy: { type: DataTypes.UUID, allowNull: false },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { sequelize, tableName: 'product_compliance_dossiers', timestamps: true, indexes: [{ unique: true, fields: ['productVersionId', 'revisionNumber'] }, { fields: ['lifecycleStatus', 'reviewerId'] }] });

interface TemplateAttributes {
  id: string;
  seriesKey: string;
  name: string;
  description: string | null;
  version: string;
  status: ProductQuestionnaireStatus;
  createdBy: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
type TemplateCreation = Optional<TemplateAttributes, 'id' | 'description' | 'status' | 'publishedAt' | 'createdAt' | 'updatedAt'>;
export class ProductQuestionnaireTemplate extends Model<TemplateAttributes, TemplateCreation> implements TemplateAttributes {
  declare id: string;
  declare seriesKey: string;
  declare name: string;
  declare description: string | null;
  declare version: string;
  declare status: ProductQuestionnaireStatus;
  declare createdBy: string;
  declare publishedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}
ProductQuestionnaireTemplate.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  seriesKey: { type: DataTypes.STRING(100), allowNull: false },
  name: { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  version: { type: DataTypes.STRING(50), allowNull: false },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'draft', validate: { isIn: [['draft', 'active', 'retired']] } },
  createdBy: { type: DataTypes.UUID, allowNull: false },
  publishedAt: { type: DataTypes.DATE, allowNull: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { sequelize, tableName: 'product_questionnaire_templates', timestamps: true, indexes: [{ unique: true, fields: ['seriesKey', 'version'] }, { fields: ['status'] }] });

interface QuestionAttributes {
  id: string;
  templateId: string;
  stableKey: string;
  title: string;
  description: string | null;
  questionType: ProductQuestionType;
  required: boolean;
  options: unknown[];
  sortOrder: number;
}
type QuestionCreation = Optional<QuestionAttributes, 'id' | 'description' | 'required' | 'options' | 'sortOrder'>;
export class ProductQuestion extends Model<QuestionAttributes, QuestionCreation> implements QuestionAttributes {
  declare id: string;
  declare templateId: string;
  declare stableKey: string;
  declare title: string;
  declare description: string | null;
  declare questionType: ProductQuestionType;
  declare required: boolean;
  declare options: unknown[];
  declare sortOrder: number;
}
ProductQuestion.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  templateId: { type: DataTypes.UUID, allowNull: false },
  stableKey: { type: DataTypes.STRING(120), allowNull: false },
  title: { type: DataTypes.TEXT, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  questionType: { type: DataTypes.STRING(30), allowNull: false, validate: { isIn: [['boolean', 'single_select', 'multi_select', 'short_text', 'long_text', 'number', 'date']] } },
  required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  options: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, { sequelize, tableName: 'product_questions', timestamps: false, indexes: [{ unique: true, fields: ['templateId', 'stableKey'] }] });

interface RuleAttributes { id: string; productTypeId: string; templateId: string; required: boolean; active: boolean; createdBy: string; createdAt: Date; }
type RuleCreation = Optional<RuleAttributes, 'id' | 'required' | 'active' | 'createdAt'>;
export class ProductTypeQuestionnaireRule extends Model<RuleAttributes, RuleCreation> implements RuleAttributes {
  declare id: string; declare productTypeId: string; declare templateId: string; declare required: boolean; declare active: boolean; declare createdBy: string; declare createdAt: Date;
}
ProductTypeQuestionnaireRule.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  productTypeId: { type: DataTypes.UUID, allowNull: false },
  templateId: { type: DataTypes.UUID, allowNull: false },
  required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  createdBy: { type: DataTypes.UUID, allowNull: false },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { sequelize, tableName: 'product_type_questionnaire_rules', timestamps: false, indexes: [{ unique: true, fields: ['productTypeId', 'templateId'] }] });

interface AssignmentAttributes { id: string; dossierId: string; templateId: string; assignmentSource: DossierAssignmentSource; adjustmentReason: string | null; templateSnapshot: Record<string, unknown>; createdAt: Date; }
type AssignmentCreation = Optional<AssignmentAttributes, 'id' | 'assignmentSource' | 'adjustmentReason' | 'templateSnapshot' | 'createdAt'>;
export class ProductDossierQuestionnaire extends Model<AssignmentAttributes, AssignmentCreation> implements AssignmentAttributes {
  declare id: string; declare dossierId: string; declare templateId: string; declare assignmentSource: DossierAssignmentSource; declare adjustmentReason: string | null; declare templateSnapshot: Record<string, unknown>; declare createdAt: Date;
}
ProductDossierQuestionnaire.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true }, dossierId: { type: DataTypes.UUID, allowNull: false }, templateId: { type: DataTypes.UUID, allowNull: false },
  assignmentSource: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'rule', validate: { isIn: [['rule', 'manual']] } }, adjustmentReason: { type: DataTypes.TEXT, allowNull: true },
  templateSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }, createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { sequelize, tableName: 'product_dossier_questionnaires', timestamps: false, indexes: [{ unique: true, fields: ['dossierId', 'templateId'] }] });

interface AnswerAttributes { id: string; dossierQuestionnaireId: string; questionId: string; stableQuestionKey: string; response: unknown; inheritedFromAnswerId: string | null; inheritanceStatus: DossierInheritanceStatus; updatedBy: string; updatedAt: Date; }
type AnswerCreation = Optional<AnswerAttributes, 'id' | 'response' | 'inheritedFromAnswerId' | 'inheritanceStatus' | 'updatedAt'>;
export class ProductDossierAnswer extends Model<AnswerAttributes, AnswerCreation> implements AnswerAttributes {
  declare id: string; declare dossierQuestionnaireId: string; declare questionId: string; declare stableQuestionKey: string; declare response: unknown; declare inheritedFromAnswerId: string | null; declare inheritanceStatus: DossierInheritanceStatus; declare updatedBy: string; declare updatedAt: Date;
}
ProductDossierAnswer.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true }, dossierQuestionnaireId: { type: DataTypes.UUID, allowNull: false }, questionId: { type: DataTypes.UUID, allowNull: false }, stableQuestionKey: { type: DataTypes.STRING(120), allowNull: false },
  response: { type: DataTypes.JSONB, allowNull: true }, inheritedFromAnswerId: { type: DataTypes.UUID, allowNull: true }, inheritanceStatus: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'unanswered', validate: { isIn: [['new', 'inherited', 'modified', 'unanswered']] } },
  updatedBy: { type: DataTypes.UUID, allowNull: false }, updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { sequelize, tableName: 'product_dossier_answers', timestamps: false, indexes: [{ unique: true, fields: ['dossierQuestionnaireId', 'questionId'] }] });

interface PermissionAttributes { id: string; dossierId: string; platform: string; permissionName: string; purpose: string; required: boolean; inheritedFromPermissionId: string | null; sortOrder: number; }
type PermissionCreation = Optional<PermissionAttributes, 'id' | 'required' | 'inheritedFromPermissionId' | 'sortOrder'>;
export class ProductPlatformPermission extends Model<PermissionAttributes, PermissionCreation> implements PermissionAttributes {
  declare id: string; declare dossierId: string; declare platform: string; declare permissionName: string; declare purpose: string; declare required: boolean; declare inheritedFromPermissionId: string | null; declare sortOrder: number;
}
ProductPlatformPermission.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true }, dossierId: { type: DataTypes.UUID, allowNull: false }, platform: { type: DataTypes.STRING(50), allowNull: false }, permissionName: { type: DataTypes.STRING(160), allowNull: false }, purpose: { type: DataTypes.TEXT, allowNull: false },
  required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, inheritedFromPermissionId: { type: DataTypes.UUID, allowNull: true }, sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, { sequelize, tableName: 'product_platform_permissions', timestamps: false, indexes: [{ fields: ['dossierId', 'sortOrder'] }] });

interface DataItemAttributes { id: string; dossierId: string; name: string; category: string; dataSubjectCategories: string[]; source: string | null; sensitive: boolean; required: boolean; notes: string | null; inheritedFromDataItemId: string | null; sortOrder: number; }
type DataItemCreation = Optional<DataItemAttributes, 'id' | 'dataSubjectCategories' | 'source' | 'sensitive' | 'required' | 'notes' | 'inheritedFromDataItemId' | 'sortOrder'>;
export class ProductDataItem extends Model<DataItemAttributes, DataItemCreation> implements DataItemAttributes {
  declare id: string; declare dossierId: string; declare name: string; declare category: string; declare dataSubjectCategories: string[]; declare source: string | null; declare sensitive: boolean; declare required: boolean; declare notes: string | null; declare inheritedFromDataItemId: string | null; declare sortOrder: number;
}
ProductDataItem.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true }, dossierId: { type: DataTypes.UUID, allowNull: false }, name: { type: DataTypes.STRING(160), allowNull: false }, category: { type: DataTypes.STRING(120), allowNull: false },
  dataSubjectCategories: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }, source: { type: DataTypes.STRING(200), allowNull: true }, sensitive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, notes: { type: DataTypes.TEXT, allowNull: true }, inheritedFromDataItemId: { type: DataTypes.UUID, allowNull: true }, sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, { sequelize, tableName: 'product_data_items', timestamps: false, indexes: [{ fields: ['dossierId', 'sortOrder'] }] });

interface ActivityAttributes { id: string; dossierId: string; name: string; purpose: string; legalBasis: string; controllerRole: string; dataSubjectCategories: string[]; recipientCategories: string[]; internationalTransfer: boolean; transferCountries: string[]; transferSafeguards: string | null; retentionPeriod: string; securityMeasures: string; responsibleParty: string; inheritedFromActivityId: string | null; sortOrder: number; }
type ActivityCreation = Optional<ActivityAttributes, 'id' | 'controllerRole' | 'dataSubjectCategories' | 'recipientCategories' | 'internationalTransfer' | 'transferCountries' | 'transferSafeguards' | 'inheritedFromActivityId' | 'sortOrder'>;
export class ProductProcessingActivity extends Model<ActivityAttributes, ActivityCreation> implements ActivityAttributes {
  declare id: string; declare dossierId: string; declare name: string; declare purpose: string; declare legalBasis: string; declare controllerRole: string; declare dataSubjectCategories: string[]; declare recipientCategories: string[]; declare internationalTransfer: boolean; declare transferCountries: string[]; declare transferSafeguards: string | null; declare retentionPeriod: string; declare securityMeasures: string; declare responsibleParty: string; declare inheritedFromActivityId: string | null; declare sortOrder: number;
}
ProductProcessingActivity.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true }, dossierId: { type: DataTypes.UUID, allowNull: false }, name: { type: DataTypes.STRING(200), allowNull: false }, purpose: { type: DataTypes.TEXT, allowNull: false }, legalBasis: { type: DataTypes.STRING(160), allowNull: false }, controllerRole: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'controller' },
  dataSubjectCategories: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }, recipientCategories: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }, internationalTransfer: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, transferCountries: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }, transferSafeguards: { type: DataTypes.TEXT, allowNull: true }, retentionPeriod: { type: DataTypes.TEXT, allowNull: false }, securityMeasures: { type: DataTypes.TEXT, allowNull: false }, responsibleParty: { type: DataTypes.STRING(200), allowNull: false }, inheritedFromActivityId: { type: DataTypes.UUID, allowNull: true }, sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, { sequelize, tableName: 'product_processing_activities', timestamps: false, indexes: [{ fields: ['dossierId', 'sortOrder'] }] });

interface PermissionLinkAttributes { id: string; permissionId: string; dataItemId: string; }
type PermissionLinkCreation = Optional<PermissionLinkAttributes, 'id'>;
export class ProductPermissionDataItem extends Model<PermissionLinkAttributes, PermissionLinkCreation> implements PermissionLinkAttributes {
  declare id: string; declare permissionId: string; declare dataItemId: string;
}
ProductPermissionDataItem.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true }, permissionId: { type: DataTypes.UUID, allowNull: false }, dataItemId: { type: DataTypes.UUID, allowNull: false },
}, { sequelize, tableName: 'product_permission_data_items', timestamps: false, indexes: [{ unique: true, fields: ['permissionId', 'dataItemId'] }] });

interface ProcessingLinkAttributes { id: string; activityId: string; dataItemId: string; }
type ProcessingLinkCreation = Optional<ProcessingLinkAttributes, 'id'>;
export class ProductProcessingDataItem extends Model<ProcessingLinkAttributes, ProcessingLinkCreation> implements ProcessingLinkAttributes {
  declare id: string; declare activityId: string; declare dataItemId: string;
}
ProductProcessingDataItem.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true }, activityId: { type: DataTypes.UUID, allowNull: false }, dataItemId: { type: DataTypes.UUID, allowNull: false },
}, { sequelize, tableName: 'product_processing_data_items', timestamps: false, indexes: [{ unique: true, fields: ['activityId', 'dataItemId'] }] });
