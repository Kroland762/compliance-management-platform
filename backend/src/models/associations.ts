// ========================================
// 模型关联关系定义
// ========================================

import User from './User';
import AuthSession from './AuthSession';
import QuestionnaireTemplate from './QuestionnaireTemplate';
import QuestionTemplate from './QuestionTemplate';
import AuditTask from './AuditTask';
import QuestionItem from './QuestionItem';
import EvidenceFile from './EvidenceFile';
import RiskRecord from './RiskRecord';
import Notification from './Notification';
import AuditLog from './AuditLog';
import Department from './Department';
import DepartmentMember from './DepartmentMember';
import TenantMember from './TenantMember';
import MemberRole from './MemberRole';
import Role from './Role';
import Asset from './Asset';
import AssessmentAsset from './AssessmentAsset';
import AssessmentControlAsset from './AssessmentControlAsset';
import RiskSource from './RiskSource';
import RiskAffectedAsset from './RiskAffectedAsset';
import RemediationAction from './RemediationAction';
import RiskActionLink from './RiskActionLink';
import AssessmentPlan from './AssessmentPlan';
import AssessmentPlanExecution from './AssessmentPlanExecution';
import AssessmentAuditor from './AssessmentAuditor';
import Finding from './Finding';
import FindingActionLink from './FindingActionLink';
import RiskFindingLink from './RiskFindingLink';
import EvaluationAsset from './EvaluationAsset';
import EvaluationHistoryLink from './EvaluationHistoryLink';
import {
  ProductType,
  Product,
  ProductVersion,
  ProductComplianceDossier,
  ProductQuestionnaireTemplate,
  ProductQuestion,
  ProductTypeQuestionnaireRule,
  ProductDossierQuestionnaire,
  ProductDossierAnswer,
  ProductPlatformPermission,
  ProductDataItem,
  ProductProcessingActivity,
  ProductPermissionDataItem,
  ProductProcessingDataItem,
} from './ProductCompliance';

export function setupAssociations(): void {
  User.hasMany(AuthSession, { foreignKey: 'userId', as: 'authSessions', onDelete: 'CASCADE' });
  AuthSession.belongsTo(User, { foreignKey: 'userId', as: 'user' });

  // QuestionnaireTemplate 1:N QuestionTemplate
  QuestionnaireTemplate.hasMany(QuestionTemplate, { foreignKey: 'templateId', as: 'templateQuestions' });
  QuestionTemplate.belongsTo(QuestionnaireTemplate, { foreignKey: 'templateId', as: 'template' });

  // QuestionnaireTemplate 1:N AuditTask
  QuestionnaireTemplate.hasMany(AuditTask, { foreignKey: 'templateId', as: 'tasks' });
  AuditTask.belongsTo(QuestionnaireTemplate, { foreignKey: 'templateId', as: 'template' });

  // User 1:N AuditTask (creator)
  User.hasMany(AuditTask, { foreignKey: 'createdBy', as: 'createdTasks' });
  AuditTask.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

  // User 1:N AuditTask (assignee)
  User.hasMany(AuditTask, { foreignKey: 'assignedTo', as: 'assignedTasks' });
  AuditTask.belongsTo(User, { foreignKey: 'assignedTo', as: 'assignee' });

  // User 1:N AuditTask (reviewer)
  User.hasMany(AuditTask, { foreignKey: 'reviewerId', as: 'reviewedTasks' });
  AuditTask.belongsTo(User, { foreignKey: 'reviewerId', as: 'reviewer' });

  AuditTask.hasMany(AssessmentAuditor, { foreignKey: 'taskId', as: 'auditors', onDelete: 'CASCADE' });
  AssessmentAuditor.belongsTo(AuditTask, { foreignKey: 'taskId', as: 'task' });
  User.hasMany(AssessmentAuditor, { foreignKey: 'auditorUserId', as: 'assessmentAssignments' });
  AssessmentAuditor.belongsTo(User, { foreignKey: 'auditorUserId', as: 'auditor' });

  // AuditTask 1:N QuestionItem
  AuditTask.hasMany(QuestionItem, { foreignKey: 'taskId', as: 'taskQuestions', onDelete: 'CASCADE' });
  QuestionItem.belongsTo(AuditTask, { foreignKey: 'taskId', as: 'task' });

  // QuestionTemplate 1:N QuestionItem
  QuestionTemplate.hasMany(QuestionItem, { foreignKey: 'templateQuestionId', as: 'items' });
  QuestionItem.belongsTo(QuestionTemplate, { foreignKey: 'templateQuestionId', as: 'templateQuestion' });

  AuditTask.hasMany(AssessmentAsset, { foreignKey: 'taskId', as: 'assessmentAssets', onDelete: 'RESTRICT' });
  AssessmentAsset.belongsTo(AuditTask, { foreignKey: 'taskId', as: 'task' });
  Asset.hasMany(AssessmentAsset, { foreignKey: 'assetId', as: 'assessmentScopes', onDelete: 'RESTRICT' });
  AssessmentAsset.belongsTo(Asset, { foreignKey: 'assetId', as: 'asset' });
  AuditTask.hasMany(AssessmentControlAsset, { foreignKey: 'taskId', as: 'controlAssetMatrix', onDelete: 'CASCADE' });
  AssessmentControlAsset.belongsTo(AuditTask, { foreignKey: 'taskId', as: 'task' });
  QuestionTemplate.hasMany(AssessmentControlAsset, { foreignKey: 'controlPointId', as: 'assetMappings', onDelete: 'RESTRICT' });
  AssessmentControlAsset.belongsTo(QuestionTemplate, { foreignKey: 'controlPointId', as: 'controlPoint' });
  Asset.hasMany(AssessmentControlAsset, { foreignKey: 'assetId', as: 'controlMappings', onDelete: 'RESTRICT' });
  AssessmentControlAsset.belongsTo(Asset, { foreignKey: 'assetId', as: 'asset' });
  Asset.hasMany(QuestionItem, { foreignKey: 'assetId', as: 'controlEvaluations', onDelete: 'RESTRICT' });
  QuestionItem.belongsTo(Asset, { foreignKey: 'assetId', as: 'asset' });
  QuestionItem.hasMany(EvaluationAsset, { foreignKey: 'questionItemId', as: 'evaluationAssets', onDelete: 'CASCADE' });
  EvaluationAsset.belongsTo(QuestionItem, { foreignKey: 'questionItemId', as: 'evaluation' });
  Asset.hasMany(EvaluationAsset, { foreignKey: 'assetId', as: 'evaluationLinks', onDelete: 'RESTRICT' });
  EvaluationAsset.belongsTo(Asset, { foreignKey: 'assetId', as: 'asset' });
  QuestionItem.hasMany(EvaluationHistoryLink, { foreignKey: 'currentEvaluationId', as: 'historyLinks', onDelete: 'CASCADE' });
  EvaluationHistoryLink.belongsTo(QuestionItem, { foreignKey: 'currentEvaluationId', as: 'currentEvaluation' });
  QuestionItem.hasMany(EvaluationHistoryLink, { foreignKey: 'sourceEvaluationId', as: 'historyReferences', onDelete: 'RESTRICT' });
  EvaluationHistoryLink.belongsTo(QuestionItem, { foreignKey: 'sourceEvaluationId', as: 'sourceEvaluation' });

  AuditTask.hasMany(Finding, { foreignKey: 'taskId', as: 'findings', onDelete: 'RESTRICT' });
  Finding.belongsTo(AuditTask, { foreignKey: 'taskId', as: 'task' });
  QuestionItem.hasOne(Finding, { foreignKey: 'evaluationId', as: 'finding', onDelete: 'RESTRICT' });
  Finding.belongsTo(QuestionItem, { foreignKey: 'evaluationId', as: 'evaluation' });

  // QuestionItem 1:N EvidenceFile
  QuestionItem.hasMany(EvidenceFile, { foreignKey: 'questionItemId', as: 'evidenceFiles', onDelete: 'CASCADE' });
  EvidenceFile.belongsTo(QuestionItem, { foreignKey: 'questionItemId', as: 'questionItem' });
  RemediationAction.hasMany(EvidenceFile, { foreignKey: 'remediationActionId', as: 'evidenceFiles', onDelete: 'RESTRICT' });
  EvidenceFile.belongsTo(RemediationAction, { foreignKey: 'remediationActionId', as: 'remediationAction' });

  // User 1:N EvidenceFile (uploader)
  User.hasMany(EvidenceFile, { foreignKey: 'uploadedBy', as: 'uploadedFiles' });
  EvidenceFile.belongsTo(User, { foreignKey: 'uploadedBy', as: 'uploader' });

  // AuditTask 1:N RiskRecord
  AuditTask.hasMany(RiskRecord, { foreignKey: 'taskId', as: 'riskRecords', onDelete: 'CASCADE' });
  RiskRecord.belongsTo(AuditTask, { foreignKey: 'taskId', as: 'task' });

  RiskRecord.hasMany(RiskSource, { foreignKey: 'riskId', as: 'sources', onDelete: 'RESTRICT' });
  RiskSource.belongsTo(RiskRecord, { foreignKey: 'riskId', as: 'risk' });
  QuestionItem.hasMany(RiskSource, { foreignKey: 'controlEvaluationId', as: 'riskSources', onDelete: 'RESTRICT' });
  RiskSource.belongsTo(QuestionItem, { foreignKey: 'controlEvaluationId', as: 'controlEvaluation' });

  RiskRecord.hasMany(RiskAffectedAsset, { foreignKey: 'riskId', as: 'affectedAssets', onDelete: 'RESTRICT' });
  RiskAffectedAsset.belongsTo(RiskRecord, { foreignKey: 'riskId', as: 'risk' });
  Asset.hasMany(RiskAffectedAsset, { foreignKey: 'assetId', as: 'riskImpacts', onDelete: 'RESTRICT' });
  RiskAffectedAsset.belongsTo(Asset, { foreignKey: 'assetId', as: 'asset' });

  RiskRecord.hasMany(RiskActionLink, { foreignKey: 'riskId', as: 'actionLinks', onDelete: 'RESTRICT' });
  RiskActionLink.belongsTo(RiskRecord, { foreignKey: 'riskId', as: 'risk' });
  RemediationAction.hasMany(RiskActionLink, { foreignKey: 'actionId', as: 'riskLinks', onDelete: 'RESTRICT' });
  RiskActionLink.belongsTo(RemediationAction, { foreignKey: 'actionId', as: 'action' });

  Finding.hasMany(FindingActionLink, { foreignKey: 'findingId', as: 'actionLinks', onDelete: 'RESTRICT' });
  FindingActionLink.belongsTo(Finding, { foreignKey: 'findingId', as: 'finding' });
  RemediationAction.hasMany(FindingActionLink, { foreignKey: 'actionId', as: 'findingLinks', onDelete: 'RESTRICT' });
  FindingActionLink.belongsTo(RemediationAction, { foreignKey: 'actionId', as: 'action' });

  RiskRecord.hasMany(RiskFindingLink, { foreignKey: 'riskId', as: 'findingLinks', onDelete: 'RESTRICT' });
  RiskFindingLink.belongsTo(RiskRecord, { foreignKey: 'riskId', as: 'risk' });
  Finding.hasMany(RiskFindingLink, { foreignKey: 'findingId', as: 'riskLinks', onDelete: 'RESTRICT' });
  RiskFindingLink.belongsTo(Finding, { foreignKey: 'findingId', as: 'finding' });

  AssessmentPlan.hasMany(AssessmentPlanExecution, { foreignKey: 'planId', as: 'executions', onDelete: 'RESTRICT' });
  AssessmentPlanExecution.belongsTo(AssessmentPlan, { foreignKey: 'planId', as: 'plan' });
  AuditTask.hasMany(AssessmentPlanExecution, { foreignKey: 'taskId', as: 'planExecutions', onDelete: 'RESTRICT' });
  AssessmentPlanExecution.belongsTo(AuditTask, { foreignKey: 'taskId', as: 'task' });

  // User 1:N Notification
  User.hasMany(Notification, { foreignKey: 'userId', as: 'notifications' });
  Notification.belongsTo(User, { foreignKey: 'userId', as: 'user' });

  // AuditTask 1:N Notification
  AuditTask.hasMany(Notification, { foreignKey: 'taskId', as: 'notifications', onDelete: 'CASCADE' });
  Notification.belongsTo(AuditTask, { foreignKey: 'taskId', as: 'task' });

  // User 1:N AuditLog
  User.hasMany(AuditLog, { foreignKey: 'userId', as: 'auditLogs' });
  AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });

  // Tenant member, role and department relationships. Business actor fields
  // deliberately continue to reference public User IDs.
  User.hasMany(TenantMember, { foreignKey: 'userId', as: 'tenantMembers' });
  TenantMember.belongsTo(User, { foreignKey: 'userId', as: 'user' });
  TenantMember.belongsToMany(Role, { through: MemberRole, foreignKey: 'memberId', otherKey: 'roleId', as: 'roles' });
  Role.belongsToMany(TenantMember, { through: MemberRole, foreignKey: 'roleId', otherKey: 'memberId', as: 'members' });
  TenantMember.hasMany(MemberRole, { foreignKey: 'memberId', as: 'memberRoles', onDelete: 'CASCADE' });
  MemberRole.belongsTo(TenantMember, { foreignKey: 'memberId', as: 'member' });
  Role.hasMany(MemberRole, { foreignKey: 'roleId', as: 'memberRoles', onDelete: 'CASCADE' });
  MemberRole.belongsTo(Role, { foreignKey: 'roleId', as: 'role' });

  Department.hasMany(Department, { foreignKey: 'parentId', as: 'children' });
  Department.belongsTo(Department, { foreignKey: 'parentId', as: 'parent' });
  Department.belongsToMany(TenantMember, { through: DepartmentMember, foreignKey: 'departmentId', otherKey: 'memberId', as: 'members' });
  TenantMember.belongsToMany(Department, { through: DepartmentMember, foreignKey: 'memberId', otherKey: 'departmentId', as: 'departments' });
  Department.hasMany(DepartmentMember, { foreignKey: 'departmentId', as: 'departmentMembers', onDelete: 'CASCADE' });
  DepartmentMember.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });
  TenantMember.hasMany(DepartmentMember, { foreignKey: 'memberId', as: 'departmentMembers', onDelete: 'CASCADE' });
  DepartmentMember.belongsTo(TenantMember, { foreignKey: 'memberId', as: 'member' });

  ProductType.hasMany(Product, { foreignKey: 'defaultProductTypeId', as: 'products' });
  Product.belongsTo(ProductType, { foreignKey: 'defaultProductTypeId', as: 'defaultProductType' });
  Product.hasMany(ProductVersion, { foreignKey: 'productId', as: 'versions', onDelete: 'RESTRICT' });
  ProductVersion.belongsTo(Product, { foreignKey: 'productId', as: 'product' });
  ProductType.hasMany(ProductVersion, { foreignKey: 'productTypeId', as: 'versions' });
  ProductVersion.belongsTo(ProductType, { foreignKey: 'productTypeId', as: 'productType' });
  ProductVersion.hasMany(ProductComplianceDossier, { foreignKey: 'productVersionId', as: 'dossiers', onDelete: 'RESTRICT' });
  ProductComplianceDossier.belongsTo(ProductVersion, { foreignKey: 'productVersionId', as: 'productVersion' });
  ProductComplianceDossier.belongsTo(ProductComplianceDossier, { foreignKey: 'sourceDossierId', as: 'sourceDossier' });
  ProductComplianceDossier.belongsTo(ProductComplianceDossier, { foreignKey: 'supersedesDossierId', as: 'supersededDossier' });

  ProductQuestionnaireTemplate.hasMany(ProductQuestion, { foreignKey: 'templateId', as: 'questions', onDelete: 'RESTRICT' });
  ProductQuestion.belongsTo(ProductQuestionnaireTemplate, { foreignKey: 'templateId', as: 'template' });
  ProductType.hasMany(ProductTypeQuestionnaireRule, { foreignKey: 'productTypeId', as: 'questionnaireRules', onDelete: 'RESTRICT' });
  ProductTypeQuestionnaireRule.belongsTo(ProductType, { foreignKey: 'productTypeId', as: 'productType' });
  ProductQuestionnaireTemplate.hasMany(ProductTypeQuestionnaireRule, { foreignKey: 'templateId', as: 'typeRules', onDelete: 'RESTRICT' });
  ProductTypeQuestionnaireRule.belongsTo(ProductQuestionnaireTemplate, { foreignKey: 'templateId', as: 'template' });

  ProductComplianceDossier.hasMany(ProductDossierQuestionnaire, { foreignKey: 'dossierId', as: 'questionnaires', onDelete: 'CASCADE' });
  ProductDossierQuestionnaire.belongsTo(ProductComplianceDossier, { foreignKey: 'dossierId', as: 'dossier' });
  ProductDossierQuestionnaire.belongsTo(ProductQuestionnaireTemplate, { foreignKey: 'templateId', as: 'template' });
  ProductDossierQuestionnaire.hasMany(ProductDossierAnswer, { foreignKey: 'dossierQuestionnaireId', as: 'answers', onDelete: 'CASCADE' });
  ProductDossierAnswer.belongsTo(ProductDossierQuestionnaire, { foreignKey: 'dossierQuestionnaireId', as: 'questionnaire' });
  ProductDossierAnswer.belongsTo(ProductQuestion, { foreignKey: 'questionId', as: 'question' });

  ProductComplianceDossier.hasMany(ProductPlatformPermission, { foreignKey: 'dossierId', as: 'platformPermissions', onDelete: 'CASCADE' });
  ProductPlatformPermission.belongsTo(ProductComplianceDossier, { foreignKey: 'dossierId', as: 'dossier' });
  ProductComplianceDossier.hasMany(ProductDataItem, { foreignKey: 'dossierId', as: 'dataItems', onDelete: 'CASCADE' });
  ProductDataItem.belongsTo(ProductComplianceDossier, { foreignKey: 'dossierId', as: 'dossier' });
  ProductComplianceDossier.hasMany(ProductProcessingActivity, { foreignKey: 'dossierId', as: 'processingActivities', onDelete: 'CASCADE' });
  ProductProcessingActivity.belongsTo(ProductComplianceDossier, { foreignKey: 'dossierId', as: 'dossier' });
  ProductPlatformPermission.belongsToMany(ProductDataItem, { through: ProductPermissionDataItem, foreignKey: 'permissionId', otherKey: 'dataItemId', as: 'dataItems' });
  ProductDataItem.belongsToMany(ProductPlatformPermission, { through: ProductPermissionDataItem, foreignKey: 'dataItemId', otherKey: 'permissionId', as: 'platformPermissions' });
  ProductProcessingActivity.belongsToMany(ProductDataItem, { through: ProductProcessingDataItem, foreignKey: 'activityId', otherKey: 'dataItemId', as: 'dataItems' });
  ProductDataItem.belongsToMany(ProductProcessingActivity, { through: ProductProcessingDataItem, foreignKey: 'dataItemId', otherKey: 'activityId', as: 'processingActivities' });
}
