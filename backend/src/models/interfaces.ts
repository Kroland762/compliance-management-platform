// ========================================
// 核心数据实体接口
// ========================================

import {
  AssessmentType, TaskStatus, AnswerStatus,
  ComplianceStatus, RiskLevel,
  NotificationType, OperationType,
  EvidenceType,
  EvidenceStatus, EvidenceScanStatus,
} from './enums';

// ---- Global identity and tenant member ----
export interface IUserIdentity {
  id: string;
  username: string;
  passwordHash: string;
  email: string | null;
  globalRoleTemplateId: string | null;
  mustChangePassword: boolean;
  lastLogin: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITenantMember {
  id: string;
  userId: string;
  displayName: string;
  employeeNo: string | null;
  email: string | null;
  status: 'invited' | 'active' | 'suspended' | 'left';
  sessionVersion: number;
}

// ---- QuestionnaireTemplate ----
export interface IQuestionnaireTemplate {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: Date;
  questionCount: number;
}

// ---- QuestionTemplate ----
export interface IQuestionTemplate {
  id: string;
  templateId: string;
  sequenceNumber: string;
  controlDomain: string;
  controlPoint: string;
  referenceAnswer: string | null;
  historicalEvidencePath: string | null;
  responsibleDepartment: string | null;
  responsiblePerson: string | null;
}

// ---- AuditTask ----
export interface IAuditTask {
  id: string;
  templateId: string;
  assessmentType: AssessmentType;
  assessmentTarget: string;
  createdBy: string;
  assignedTo: string;
  departmentId: string;
  status: TaskStatus;
  returnReason: string | null;
  returnedAssignees: string[] | null;
  createdAt: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
}

export interface IAuditTaskCreate {
  templateId: string;
  assessmentType: AssessmentType;
  assessmentTarget: string;
  assignedTo: string;
  departmentId: string;
  questionAssignments?: IQuestionAssignment[];
}

export interface IQuestionAssignment {
  questionTemplateId: string;
  responsibleDepartment?: string;
  responsiblePerson?: string;
}

// ---- QuestionItem ----
export interface IQuestionItem {
  id: string;
  taskId: string;
  templateQuestionId: string;
  sequenceNumber: string;
  controlDomain: string;
  controlPoint: string;
  referenceAnswer: string | null;
  historicalEvidencePath: string | null;
  responsibleDepartment: string | null;
  responsiblePerson: string | null;
  currentStatusDescription: string | null;
  answerStatus: AnswerStatus;
  complianceStatus: ComplianceStatus | null;
  answeredAt: Date | null;
  reviewedAt: Date | null;
}

// ---- EvidenceFile ----
export interface IEvidenceFile {
  id: string;
  questionItemId: string;
  evidenceType: EvidenceType;
  version: number;
  sha256: string | null;
  scanStatus: EvidenceScanStatus;
  status: EvidenceStatus;
  isLocked: boolean;
  originalFilename: string;
  storedFilename: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  uploadedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
}

// ---- RiskRecord ----
export interface IRiskRecord {
  id: string;
  taskId: string | null;
  code: string;
  title: string;
  description: string;
  riskLevel: RiskLevel;
  treatmentStrategy: string;
  status: string;
  identifiedAt: Date;
  updatedAt: Date;
}

// ---- Notification ----
export interface INotification {
  id: string;
  userId: string;
  taskId: string;
  notificationType: NotificationType;
  title: string;
  content: string;
  isRead: boolean;
  createdAt: Date;
  readAt: Date | null;
}

// ---- AuditLog ----
export interface IAuditLog {
  id: string;
  userId: string;
  operationType: OperationType;
  resourceType: string;
  resourceId: string | null;
  operationDetails: string | null;
  success: boolean;
  ipAddress: string | null;
  createdAt: Date;
}
