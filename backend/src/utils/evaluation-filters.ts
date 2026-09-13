import { AppError } from './http';
import {
  ComplianceStatus,
  EvaluationWorkflowStatus,
} from '../models';

export type PresenceFilter = 'present' | 'absent';
export type AnswerFilter = 'answered' | 'unanswered';

export type DynamicEvaluationFilter =
  | { operator: 'in'; values: string[]; includeEmpty?: boolean }
  | { operator: 'contains'; value: string }
  | { operator: 'empty'; value: boolean };

export interface EvaluationFilters {
  assetIds?: string[];
  controlDomains?: string[];
  workflowStatuses?: EvaluationWorkflowStatus[];
  complianceStatuses?: ComplianceStatus[];
  mine?: boolean;
  answer?: AnswerFilter;
  evidence?: PresenceFilter;
  history?: PresenceFilter;
  sequenceNumber?: string;
  controlPoint?: string;
  columns?: Record<string, DynamicEvaluationFilter>;
}

const MAX_TEXT = 200;
const MAX_VALUES = 50;
const MAX_COLUMNS = 20;

function fail(message: string): never {
  throw new AppError(400, 'VALIDATION_ERROR', message);
}

function text(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') fail(`${label} 必须是字符串`);
  const normalized = value.trim();
  if (normalized.length > MAX_TEXT) fail(`${label} 最多 ${MAX_TEXT} 个字符`);
  return normalized || undefined;
}

function values(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail(`${label} 必须是数组`);
  if (value.length > MAX_VALUES) fail(`${label} 最多选择 ${MAX_VALUES} 项`);
  const normalized = [...new Set(value.map((item) => {
    if (typeof item !== 'string') fail(`${label} 只能包含字符串`);
    const result = item.trim();
    if (!result || result.length > MAX_TEXT) fail(`${label} 包含无效值`);
    return result;
  }))];
  return normalized.length ? normalized : undefined;
}

function enumValues<T extends string>(value: unknown, allowed: T[], label: string): T[] | undefined {
  const normalized = values(value, label);
  if (normalized?.some((item) => !allowed.includes(item as T))) fail(`${label} 包含无效值`);
  return normalized as T[] | undefined;
}

export function parseEvaluationQuery(query: Record<string, unknown>): { q?: string; filters: EvaluationFilters } {
  const q = text(query.q, '关键词');
  if (query.filters !== undefined && typeof query.filters !== 'string') fail('filters 必须是 JSON 字符串');
  if (typeof query.filters === 'string' && Buffer.byteLength(query.filters, 'utf8') > 16 * 1024) fail('filters 内容过大');
  let raw: any = {};
  try { raw = query.filters ? JSON.parse(query.filters as string) : {}; }
  catch { fail('filters 不是有效的 JSON'); }
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') fail('filters 必须是对象');

  const filters: EvaluationFilters = {
    assetIds: values(raw.assetIds, '关联资产'),
    controlDomains: values(raw.controlDomains, '控制域'),
    workflowStatuses: enumValues(raw.workflowStatuses, Object.values(EvaluationWorkflowStatus), '流程状态'),
    complianceStatuses: enumValues(raw.complianceStatuses, Object.values(ComplianceStatus), '符合性结论'),
    answer: raw.answer === undefined ? undefined : (['answered', 'unanswered'].includes(raw.answer) ? raw.answer : fail('回答状态无效')),
    evidence: raw.evidence === undefined ? undefined : (['present', 'absent'].includes(raw.evidence) ? raw.evidence : fail('证据状态无效')),
    history: raw.history === undefined ? undefined : (['present', 'absent'].includes(raw.history) ? raw.history : fail('历史状态无效')),
    sequenceNumber: text(raw.sequenceNumber, '序号'),
    controlPoint: text(raw.controlPoint, '评估点'),
  };
  if (raw.mine !== undefined && typeof raw.mine !== 'boolean') fail('仅看待我处理必须是布尔值');
  if (raw.mine) filters.mine = true;

  if (raw.columns !== undefined) {
    if (!raw.columns || Array.isArray(raw.columns) || typeof raw.columns !== 'object') fail('动态列筛选必须是对象');
    const entries = Object.entries(raw.columns);
    if (entries.length > MAX_COLUMNS) fail(`动态列筛选最多 ${MAX_COLUMNS} 项`);
    filters.columns = {};
    for (const [key, condition] of entries) {
      if (!condition || Array.isArray(condition) || typeof condition !== 'object') fail(`动态列 ${key} 的筛选条件无效`);
      const input: any = condition;
      if (input.operator === 'in') {
        const selected = values(input.values, `动态列 ${key}`);
        if (input.includeEmpty !== undefined && typeof input.includeEmpty !== 'boolean') fail(`动态列 ${key} 的空值条件无效`);
        if (selected || input.includeEmpty) filters.columns[key] = { operator: 'in', values: selected || [], includeEmpty: Boolean(input.includeEmpty) };
      } else if (input.operator === 'contains') {
        const keyword = text(input.value, `动态列 ${key}`);
        if (keyword) filters.columns[key] = { operator: 'contains', value: keyword };
      } else if (input.operator === 'empty' && typeof input.value === 'boolean') {
        filters.columns[key] = { operator: 'empty', value: input.value };
      } else fail(`动态列 ${key} 的筛选运算符无效`);
    }
    if (!Object.keys(filters.columns).length) delete filters.columns;
  }
  return { q, filters };
}
