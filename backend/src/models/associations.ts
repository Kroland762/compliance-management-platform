// ========================================
// 模型关联关系定义
// ========================================

import User from './User';
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

export function setupAssociations(): void {
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

  // AuditTask 1:N QuestionItem
  AuditTask.hasMany(QuestionItem, { foreignKey: 'taskId', as: 'taskQuestions', onDelete: 'CASCADE' });
  QuestionItem.belongsTo(AuditTask, { foreignKey: 'taskId', as: 'task' });

  // QuestionTemplate 1:N QuestionItem
  QuestionTemplate.hasMany(QuestionItem, { foreignKey: 'templateQuestionId', as: 'items' });
  QuestionItem.belongsTo(QuestionTemplate, { foreignKey: 'templateQuestionId', as: 'templateQuestion' });

  // QuestionItem 1:N EvidenceFile
  QuestionItem.hasMany(EvidenceFile, { foreignKey: 'questionItemId', as: 'evidenceFiles', onDelete: 'CASCADE' });
  EvidenceFile.belongsTo(QuestionItem, { foreignKey: 'questionItemId', as: 'questionItem' });

  // User 1:N EvidenceFile (uploader)
  User.hasMany(EvidenceFile, { foreignKey: 'uploadedBy', as: 'uploadedFiles' });
  EvidenceFile.belongsTo(User, { foreignKey: 'uploadedBy', as: 'uploader' });

  // AuditTask 1:N RiskRecord
  AuditTask.hasMany(RiskRecord, { foreignKey: 'taskId', as: 'riskRecords', onDelete: 'CASCADE' });
  RiskRecord.belongsTo(AuditTask, { foreignKey: 'taskId', as: 'task' });

  // QuestionItem 1:N RiskRecord
  QuestionItem.hasMany(RiskRecord, { foreignKey: 'questionItemId', as: 'riskRecords' });
  RiskRecord.belongsTo(QuestionItem, { foreignKey: 'questionItemId', as: 'questionItem' });

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
}
