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
  CONFIGURING = 'configuring',
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  SUBMITTED = 'submitted',
  UNDER_REVIEW = 'under_review',
  COMPLETED = 'completed',
  RETURNED = 'returned',
  CANCELLED = 'cancelled',
}

/** @deprecated vNext uses EvaluationWorkflowStatus. */
export enum AnswerStatus {
  PENDING = 'pending',
  ANSWERED = 'answered',
}

export enum ComplianceStatus {
  NOT_ASSESSED = 'not_assessed',
  COMPLIANT = 'compliant',
  PARTIAL = 'partial',
  NON_COMPLIANT = 'non_compliant',
  NOT_APPLICABLE = 'not_applicable',
}

export enum RiskLevel {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum EvaluationWorkflowStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  SUBMITTED = 'submitted',
  RETURNED = 'returned',
  REVIEWED = 'reviewed',
}

export enum RiskLifecycleStatus {
  DRAFT = 'draft',
  PENDING_CONFIRMATION = 'pending_confirmation',
  OPEN = 'open',
  REMEDIATING = 'remediating',
  PENDING_VERIFICATION = 'pending_verification',
  CLOSED = 'closed',
  ACCEPTED = 'accepted',
  CANCELLED = 'cancelled',
}

export enum TreatmentStrategy {
  MITIGATE = 'mitigate',
  ACCEPT = 'accept',
  AVOID = 'avoid',
  TRANSFER = 'transfer',
}

export enum RemediationActionStatus {
  DRAFT = 'draft',
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  PENDING_VERIFICATION = 'pending_verification',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum VerificationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  NOT_REQUIRED = 'not_required',
}

export enum AssessmentPlanExecutionStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  REQUIRES_ATTENTION = 'requires_attention',
}

/** @deprecated vNext uses RemediationActionStatus. */
export enum RemediationStatus {
  REMEDIATED = 'remediated',
  IN_PROGRESS = 'in_progress',
  NOT_REMEDIATED = 'not_remediated',
}

/** @deprecated vNext uses TreatmentStrategy and RiskLifecycleStatus. */
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
  RISK_ASSIGNED = 'risk_assigned',
  RISK_REVIEW_DUE = 'risk_review_due',
  REMEDIATION_ASSIGNED = 'remediation_assigned',
  REMEDIATION_SUBMITTED = 'remediation_submitted',
  REMEDIATION_REJECTED = 'remediation_rejected',
  REMEDIATION_APPROVED = 'remediation_approved',
  ASSESSMENT_PLAN_ATTENTION = 'assessment_plan_attention',
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  QUERY = 'query',
  LOGIN = 'login',
  LOGOUT = 'logout',
}
