export type PresenceFilter = 'present' | 'absent';
export type AnswerFilter = 'answered' | 'unanswered';
export type DynamicEvaluationFilter =
  | { operator: 'in'; values: string[]; includeEmpty?: boolean }
  | { operator: 'contains'; value: string }
  | { operator: 'empty'; value: boolean };

export interface EvaluationFilters {
  assetIds?: string[];
  controlDomains?: string[];
  workflowStatuses?: string[];
  complianceStatuses?: string[];
  mine?: boolean;
  answer?: AnswerFilter;
  evidence?: PresenceFilter;
  history?: PresenceFilter;
  sequenceNumber?: string;
  controlPoint?: string;
  columns?: Record<string, DynamicEvaluationFilter>;
}

export interface EvaluationFilterOptions {
  controlDomains: string[];
  dynamicColumns: Record<string, { mode: 'select' | 'text'; options?: string[]; hasEmpty: boolean }>;
}

export function parseEvaluationFilters(value: string | null): EvaluationFilters {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export function compactEvaluationFilters(filters: EvaluationFilters): EvaluationFilters {
  const result: EvaluationFilters = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === false || value === '' || (Array.isArray(value) && !value.length)) continue;
    if (key === 'columns') {
      const columns = Object.fromEntries(Object.entries(value || {}).filter(([, condition]: any) => (
        condition?.operator === 'empty'
        || (condition?.operator === 'contains' && condition.value?.trim())
        || (condition?.operator === 'in' && (condition.values?.length || condition.includeEmpty))
      )));
      if (Object.keys(columns).length) result.columns = columns as Record<string, DynamicEvaluationFilter>;
    } else (result as any)[key] = value;
  }
  return result;
}

export function hasEvaluationFilters(filters: EvaluationFilters) {
  return Object.keys(compactEvaluationFilters(filters)).length > 0;
}
