// ========================================
// 核心数据实体接口
// ========================================

import {
  UserRole, AssessmentType, TaskStatus, AnswerStatus,
  ComplianceStatus, RiskLevel, RemediationStatus, RiskStatus,
  NotificationType, OperationType,
} from './enums';

// ---- User ----
export interface IUser {
  id: string;
  username: string;
  passwordHash: string;
  department: string | null;
  role: UserRole;
  lastLogin: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserCreate {
  username: string;
  password: string;
  department?: string;
  role: UserRole;
}

export interface IUserUpdate {
  department?: string;
  role?: UserRole;
  isActive?: boolean;
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
  riskIdentification: string | null;
  riskLevel: RiskLevel | null;
  remediationMeasures: string | null;
  answeredAt: Date | null;
  reviewedAt: Date | null;
}

// ---- EvidenceFile ----
export interface IEvidenceFile {
  id: string;
  questionItemId: string;
  originalFilename: string;
  storedFilename: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  uploadedAt: Date;
}

// ---- RiskRecord ----
export interface IRiskRecord {
  id: string;
  taskId: string;
  questionItemId: string;
  assessmentType: AssessmentType;
  assessmentTarget: string;
  riskIdentification: string;
  riskLevel: RiskLevel;
  remediationMeasures: string | null;
  remediationStatus: RemediationStatus;
  riskStatus: RiskStatus;
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
