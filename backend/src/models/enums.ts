// ========================================
// 枚举类型定义
// ========================================

export enum UserRole {
  ADMINISTRATOR = 'administrator',
  AUDITOR = 'auditor',
  USER = 'user',
}

export enum AssessmentType {
  ISO27001 = 'ISO27001',
  NETWORK_SECURITY_LEVEL = 'network_security_level',
  TELECOM_SECURITY = 'telecom_security',
  SUPPLIER_SECURITY = 'supplier_security',
}

export enum TaskStatus {
  DRAFT = 'draft',
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  SUBMITTED = 'submitted',
  UNDER_REVIEW = 'under_review',
  COMPLETED = 'completed',
  RETURNED = 'returned',
}

export enum AnswerStatus {
  PENDING = 'pending',
  ANSWERED = 'answered',
}

export enum ComplianceStatus {
  COMPLIANT = 'compliant',
  PARTIALLY_COMPLIANT = 'partially_compliant',
  NON_COMPLIANT = 'non_compliant',
  NOT_APPLICABLE = 'not_applicable',
}

export enum RiskLevel {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum RemediationStatus {
  REMEDIATED = 'remediated',
  IN_PROGRESS = 'in_progress',
  NOT_REMEDIATED = 'not_remediated',
}

export enum RiskStatus {
  RISK_ACCEPTANCE = 'risk_acceptance',
  RISK_TRANSFER = 'risk_transfer',
  RISK_REDUCTION = 'risk_reduction',
  RISK_ELIMINATION = 'risk_elimination',
}

export enum NotificationType {
  TASK_ASSIGNED = 'task_assigned',
  TASK_RETURNED = 'task_returned',
  TASK_SUBMITTED = 'task_submitted',
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  QUERY = 'query',
  LOGIN = 'login',
  LOGOUT = 'logout',
}
