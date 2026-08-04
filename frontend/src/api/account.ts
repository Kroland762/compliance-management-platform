import apiClient from './client';

// ==================== Data Sources ====================

export interface DataSource {
  id: string;
  name: string;
  sourceType: 'DATABASE';
  mappingStatus: string;
  taskCount?: number;
  totalAccounts: number;
  status: string;
  lastSyncTime: string | null;
  createdAt: string;
  updatedAt: string;
  connectionConfig?: Record<string, any> | null;
  fieldMappingConfig?: Record<string, any>;
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
  list: (params?: { keyword?: string; type?: string; status?: string }) =>
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
};

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
  list: (params?: { type?: string; severity?: string; isActive?: boolean | string }) =>
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
  cronExpression?: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
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
  status: 'pending' | 'running' | 'completed' | 'failed';
  phase: string;
  phaseProgress: number;
  accountsProcessed: number;
  problemsFound: number;
  errorMessage: string | null;
}

export const taskApi = {
  list: (params?: { status?: string; keyword?: string }) =>
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
  severity: 'high' | 'medium' | 'low';
  status: 'open' | 'acknowledged' | 'resolved' | 'false_positive';
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  statusHistory?: StatusHistory[];
}

export interface StatusHistory {
  id: string;
  fromStatus: string;
  toStatus: string;
  changedBy: string;
  changedAt: string;
  notes: string | null;
}

export const problemApi = {
  list: (params?: {
    ruleId?: string;
    severity?: string;
    status?: string;
    keyword?: string;
    startDate?: string;
    endDate?: string;
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

  trends: (params?: { period?: string }) =>
    apiClient.get('/account/dashboard/trends', { params }),

  distribution: () =>
    apiClient.get('/account/dashboard/risk-distribution'),

  ranking: (params?: { top?: number }) =>
    apiClient.get('/account/dashboard/source-ranking', { params }),
};
