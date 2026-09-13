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
  PREPARING = 'preparing',
  READY = 'ready',
  IN_PROGRESS = 'in_progress',
  PENDING_REVIEW = 'pending_review',
  PENDING_CLOSURE = 'pending_closure',
  CLOSED = 'closed',
  CANCELLED = 'cancelled',
}

export enum FindingStatus {
  OPEN = 'open',
  REMEDIATING = 'remediating',
  ESCALATED = 'escalated',
  RESOLVED = 'resolved',
  CANCELLED = 'cancelled',
}

export enum FindingDisposition {
  PENDING = 'pending',
  DIRECT_REMEDIATION = 'direct_remediation',
  RISK = 'risk',
}

/** @deprecated vNext uses EvaluationWorkflowStatus. */
export enum AnswerStatus {
  PENDING = 'pending',
  ANSWERED = 'answered',
}

export enum EvidenceType {
  CURRENT = 'current',
  HISTORICAL = 'historical',
  REMEDIATION = 'remediation',
}

export enum EvidenceStatus {
  ACTIVE = 'active',
  DELETED = 'deleted',
  QUARANTINED = 'quarantined',
}

export enum EvidenceScanStatus {
  PENDING = 'pending',
  CLEAN = 'clean',
  REJECTED = 'rejected',
  ERROR = 'error',
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

export enum RiskCreationMode {
  MANUAL = 'manual',
  EVALUATION = 'evaluation',
  FINDING_ESCALATION = 'finding_escalation',
  IMPORT = 'import',
}

export enum RiskDiscoverySource {
  DAILY_OPERATIONS = 'daily_operations',
  COMPLIANCE_ASSESSMENT = 'compliance_assessment',
  INTERNAL_AUDIT = 'internal_audit',
  SECURITY_INCIDENT = 'security_incident',
  COMPLAINT_FEEDBACK = 'complaint_feedback',
  REGULATORY_CHANGE = 'regulatory_change',
  THIRD_PARTY = 'third_party',
  OTHER = 'other',
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

export enum NotificationType {
  TASK_ASSIGNED = 'task_assigned',
  TASK_RETURNED = 'task_returned',
  TASK_SUBMITTED = 'task_submitted',
  RISK_ASSIGNED = 'risk_assigned',
  RISK_PENDING_CONFIRMATION = 'risk_pending_confirmation',
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
