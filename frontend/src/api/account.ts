import apiClient from './client';

// ==================== Data Sources ====================

export interface DataSource {
  id: string;
  name: string;
  sourceType: 'DATABASE' | 'CSV';
  mappingStatus: string;
  taskCount?: number;
  totalAccounts: number;
  status: string;
  lastSyncTime: string | null;
  createdAt: string;
  updatedAt: string;
  connectionConfig?: Record<string, any> | null;
  csvConfig?: {
    originalName?: string;
    size?: number;
    sha256?: string;
    encoding?: 'UTF-8' | 'GB18030';
    delimiter?: string;
    headers?: string[];
    rowCount?: number;
    importedAt?: string;
    needsReupload?: boolean;
  } | null;
  fieldMappingConfig?: Record<string, any>;
}

export interface CsvPreview {
  file: { originalName: string; size: number; sha256: string; encoding: string; delimiter: string };
  headers: string[];
  headerFingerprint: string;
  rowCount: number;
  sampleRows: Array<Record<string, any>>;
  rawSampleRows: Array<Record<string, string>>;
  savedMapping: Record<string, any>;
  compatibility: {
    status: 'UNMAPPED' | 'MAPPING_REQUIRED' | 'COMPATIBLE';
    missingSourceFields: string[];
    newSourceFields: string[];
  };
  warnings: {
    blankAccountRows: number[];
    duplicateAccountIds: string[];
    duplicateAccountCount: number;
  };
  changeSummary: { newCount: number; reducedCount: number; existingCount: number };
}

export interface DataSourceConfig {
  // DATABASE
  dbType?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  schema?: string;
  table?: string;
  allowedColumns?: string[];
  ssl?: boolean;
}

export interface FieldMapping {
  fieldName: string;
  sourceField: string;
  required: boolean;
  mapped: boolean;
}

export interface DataSourceAccount {
  id: string;
  accountId: string;
  accountName: string;
  [key: string]: any;
}

export interface AccountChanges {
  newCount: number;
  reducedCount: number;
  existingCount: number;
  changes: Array<{
    date: string;
    newCount: number;
    reducedCount: number;
    existingCount: number;
  }>;
}

export const dataSourceApi = {
  list: (params?: { search?: string; sourceType?: 'DATABASE' | 'CSV'; status?: 'ACTIVE' | 'INACTIVE'; page?: number; pageSize?: number }) =>
    apiClient.get('/account/data-sources', { params }),

  get: (id: string) =>
    apiClient.get(`/account/data-sources/${id}`),

  create: (data: Partial<DataSource>) =>
    apiClient.post('/account/data-sources', data),

  update: (id: string, data: Partial<DataSource>) =>
    apiClient.put(`/account/data-sources/${id}`, data),

  delete: (id: string) =>
    apiClient.delete(`/account/data-sources/${id}`),

  testConnection: (id: string) =>
    apiClient.post(`/account/data-sources/${id}/test-connection`),

  sync: (id: string, force?: boolean) =>
    apiClient.post(`/account/data-sources/${id}/sync`, undefined, { params: force ? { force: 'true' } : undefined }),

  toggle: (id: string) =>
    apiClient.patch(`/account/data-sources/${id}/toggle`),

  preview: (id: string, params?: { page?: number; pageSize?: number }) =>
    apiClient.get(`/account/data-sources/${id}/preview`, { params }),

  accountChanges: (id: string, params?: { period?: string }) =>
    apiClient.get(`/account/data-sources/${id}/account-changes`, { params }),

  previewCsv: (file: File, options?: { sourceId?: string; fieldMappingConfig?: Record<string, any>; delimiter?: string }) => {
    const formData = csvFormData(file, options);
    const url = options?.sourceId
      ? `/account/data-sources/${options.sourceId}/csv/preview`
      : '/account/data-sources/csv/preview';
    return apiClient.post(url, formData, csvRequestConfig);
  },

  uploadCsv: (file: File, data: { name: string; fieldMappingConfig: Record<string, any>; expectedSha256: string; delimiter?: string }) =>
    apiClient.post('/account/data-sources/upload', csvFormData(file, data), csvRequestConfig),

  reuploadCsv: (id: string, file: File, data: { fieldMappingConfig?: Record<string, any>; expectedSha256: string; delimiter?: string }) =>
    apiClient.post(`/account/data-sources/${id}/upload`, csvFormData(file, data), csvRequestConfig),
};

const csvRequestConfig = { headers: { 'Content-Type': 'multipart/form-data' } };

function csvFormData(file: File, values?: Record<string, any>) {
  const formData = new FormData();
  formData.append('file', file);
  Object.entries(values || {}).forEach(([key, value]) => {
    if (key === 'sourceId' || value === undefined || value === null || value === '') return;
    formData.append(key, key === 'fieldMappingConfig' ? JSON.stringify(value) : String(value));
  });
  return formData;
}

// ==================== Rules ====================

export interface Rule {
  id: string;
  name: string;
  ruleType: 'BUILTIN' | 'CUSTOM';
  severity: string;
  description: string | null;
  isActive: boolean;
  conditionLogic: Record<string, any>;
  paramsConfig: Record<string, any> | null;
  builtinKey: string | null;
  taskCount?: number;
  createdAt: string;
  updatedAt: string;
  linkedTaskIds?: string[];
}

export interface RuleCondition {
  id: string;
  field: string;
  operator: string;
  value: string;
}

export const ruleApi = {
  list: (params?: { search?: string; ruleType?: 'BUILTIN' | 'CUSTOM'; severity?: 'LOW' | 'MEDIUM' | 'HIGH'; isActive?: boolean; page?: number; pageSize?: number }) =>
    apiClient.get('/account/rules', { params }),

  get: (id: string) =>
    apiClient.get(`/account/rules/${id}`),

  create: (data: Partial<Rule>) =>
    apiClient.post('/account/rules', data),

  update: (id: string, data: Partial<Rule>) =>
    apiClient.put(`/account/rules/${id}`, data),

  delete: (id: string) =>
    apiClient.delete(`/account/rules/${id}`),

  toggle: (id: string) =>
    apiClient.patch(`/account/rules/${id}/toggle`),

  updateParams: (id: string, paramsConfig: Record<string, any>) =>
    apiClient.patch(`/account/rules/${id}/params`, { paramsConfig }),
};

// ==================== Tasks ====================

export interface Task {
  id: string;
  name: string;
  sourceName: string;
  sourceId: string;
  ruleCount: number;
  scheduleType: 'MANUAL' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CRON';
  scheduleConfig?: { expression?: string; hour?: number; minute?: number; dayOfWeek?: number; dayOfMonth?: number } | null;
  status: 'ACTIVE' | 'INACTIVE';
  lastExecTime: string | null;
  problemsFound: number;
  createdAt: string;
  updatedAt: string;
  selectedRules?: string[];
}

export interface TaskExecution {
  id: string;
  taskId: string;
  startTime: string;
  endTime: string | null;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  currentPhase: 'SYNCING' | 'MAPPING' | 'MATCHING' | 'SAVING' | null;
  phaseProgress: number;
  accountsProcessed: number;
  problemsFound: number;
  errorMessage: string | null;
}

export const taskApi = {
  list: (params?: { status?: 'ACTIVE' | 'INACTIVE'; scheduleType?: Task['scheduleType']; search?: string; page?: number; pageSize?: number }) =>
    apiClient.get('/account/tasks', { params }),

  get: (id: string) =>
    apiClient.get(`/account/tasks/${id}`),

  create: (data: Partial<Task>) =>
    apiClient.post('/account/tasks', data),

  update: (id: string, data: Partial<Task>) =>
    apiClient.put(`/account/tasks/${id}`, data),

  delete: (id: string) =>
    apiClient.delete(`/account/tasks/${id}`),

  execute: (id: string) =>
    apiClient.post(`/account/tasks/${id}/execute`),

  executions: (id: string, params?: { page?: number; pageSize?: number }) =>
    apiClient.get(`/account/tasks/${id}/executions`, { params }),
};

// ==================== Problems ====================

export interface Problem {
  id: string;
  accountId: string;
  accountName: string;
  ruleName: string;
  ruleId: string;
  problemDescription: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'PENDING' | 'PROCESSING' | 'RESOLVED' | 'AUTO_RESOLVED' | 'FALSE_POSITIVE' | 'IGNORED';
  firstDetectedAt: string;
  lastSeenAt: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  statusHistory?: StatusHistory[];
}

export interface StatusHistory {
  id: string;
  fromStatus: string;
  toStatus: string;
  changedBy: string | null;
  changedAt: string;
  notes: string | null;
  source: 'MANUAL' | 'BULK' | 'AUTO' | 'MIGRATION';
}

export const problemApi = {
  list: (params?: {
    ruleId?: string;
    severity?: string;
    status?: string;
    search?: string;
    taskId?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
  }) => apiClient.get('/account/problems', { params }),

  get: (id: string) =>
    apiClient.get(`/account/problems/${id}`),

  updateStatus: (id: string, data: { status: string; notes?: string }) =>
    apiClient.patch(`/account/problems/${id}/status`, data),

  bulkUpdate: (data: { ids: string[]; status: string; notes?: string }) =>
    apiClient.post('/account/problems/bulk-status', data),

  export: (params?: Record<string, string>) =>
    apiClient.get('/account/problems/export/data', { params, responseType: 'blob' }),
};

// ==================== Dashboard ====================

export interface DashboardOverview {
  dataSourcesCount: number;
  totalAccounts: number;
  totalProblems: number;
  highRiskCount: number;
  pendingCount: number;
}

export interface DashboardTrend {
  date: string;
  count: number;
}

export interface DashboardDistribution {
  name: string;
  value: number;
  color: string;
}

export interface DashboardRanking {
  name: string;
  count: number;
}

export const dashboardApi = {
  overview: () =>
    apiClient.get('/account/dashboard/overview'),

  trends: (params?: { days?: number }) =>
    apiClient.get('/account/dashboard/trends', { params }),

  distribution: () =>
    apiClient.get('/account/dashboard/risk-distribution'),

  ranking: (params?: { limit?: number }) =>
    apiClient.get('/account/dashboard/source-ranking', { params }),
};
