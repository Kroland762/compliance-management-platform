export type EvaluationColumnSource = 'core' | 'extra' | 'system';

export interface EvaluationColumnDefinition {
  key: string;
  label: string;
  source: EvaluationColumnSource;
  visible: boolean;
  width: number;
}

export const REQUIRED_EVALUATION_COLUMN_KEYS = ['sequenceNumber', 'controlPoint'] as const;

export const SYSTEM_EVALUATION_COLUMNS: EvaluationColumnDefinition[] = [
  { key: 'assets', label: '关联资产', source: 'system', visible: true, width: 260 },
  { key: 'assignee', label: '责任人', source: 'system', visible: true, width: 180 },
  { key: 'answer', label: '现状说明', source: 'system', visible: true, width: 320 },
  { key: 'evidence', label: '本次证据', source: 'system', visible: true, width: 220 },
  { key: 'history', label: '历史回答与证据', source: 'system', visible: true, width: 150 },
  { key: 'compliance', label: '符合性结论', source: 'system', visible: true, width: 150 },
  { key: 'findingDescription', label: '不符合项描述', source: 'system', visible: true, width: 260 },
  { key: 'findingSeverity', label: '严重度', source: 'system', visible: true, width: 130 },
  { key: 'status', label: '状态', source: 'system', visible: true, width: 120 },
  { key: 'actions', label: '流程操作', source: 'system', visible: true, width: 180 },
];

export const LOCKED_VISIBLE_EVALUATION_COLUMN_KEYS = new Set([
  ...REQUIRED_EVALUATION_COLUMN_KEYS,
  ...SYSTEM_EVALUATION_COLUMNS.map((column) => column.key),
]);

const REQUIRED_COLUMNS: EvaluationColumnDefinition[] = [
  { key: 'sequenceNumber', label: '序号', source: 'core', visible: true, width: 100 },
  { key: 'controlPoint', label: '评估点与要求', source: 'core', visible: true, width: 400 },
];

const SYSTEM_KEYS = new Set(SYSTEM_EVALUATION_COLUMNS.map((column) => column.key));
const EXCLUDED_EVALUATION_COLUMN_KEYS = new Set(['referenceAnswer']);

function mergeRequiredColumn(
  fallback: EvaluationColumnDefinition,
  existing?: Partial<EvaluationColumnDefinition>,
): EvaluationColumnDefinition {
  return {
    ...fallback,
    ...existing,
    key: fallback.key,
    label: fallback.label,
    source: 'core',
    visible: true,
    width: fallback.width,
  };
}

function mergeSystemColumn(
  fallback: EvaluationColumnDefinition,
  existing?: Partial<EvaluationColumnDefinition>,
): EvaluationColumnDefinition {
  return {
    ...fallback,
    ...existing,
    key: fallback.key,
    label: fallback.label,
    source: 'system',
    visible: true,
    width: fallback.width,
  };
}

export function normalizeEvaluationColumnSchema(
  input: Array<Partial<EvaluationColumnDefinition>> = [],
): EvaluationColumnDefinition[] {
  const seen = new Set<string>();
  const unique = input.filter((column): column is Partial<EvaluationColumnDefinition> & { key: string } => {
    if (typeof column?.key !== 'string' || !column.key || seen.has(column.key) || EXCLUDED_EVALUATION_COLUMN_KEYS.has(column.key)) return false;
    seen.add(column.key);
    return true;
  });
  const byKey = new Map(unique.map((column) => [column.key, column]));
  const required = REQUIRED_COLUMNS.map((column) => mergeRequiredColumn(column, byKey.get(column.key)));
  const hasSystemColumns = unique.some((column) => SYSTEM_KEYS.has(column.key));

  const normalizeTemplateColumn = (column: Partial<EvaluationColumnDefinition> & { key: string }): EvaluationColumnDefinition => ({
    ...column,
    key: column.key,
    label: column.label || column.key,
    source: column.source === 'extra' ? 'extra' : 'core',
    visible: column.visible !== false,
    width: Number(column.width) || 160,
  });

  if (!hasSystemColumns) {
    const templateColumns = unique
      .filter((column) => !REQUIRED_EVALUATION_COLUMN_KEYS.includes(column.key as typeof REQUIRED_EVALUATION_COLUMN_KEYS[number]))
      .map(normalizeTemplateColumn);
    return [
      ...required,
      ...SYSTEM_EVALUATION_COLUMNS.slice(0, 3).map((column) => mergeSystemColumn(column)),
      ...templateColumns,
      ...SYSTEM_EVALUATION_COLUMNS.slice(3).map((column) => mergeSystemColumn(column)),
    ];
  }

  const ordered = unique
    .map((column) => {
      const requiredColumn = REQUIRED_COLUMNS.find((definition) => definition.key === column.key);
      if (requiredColumn) return mergeRequiredColumn(requiredColumn, column);
      const systemColumn = SYSTEM_EVALUATION_COLUMNS.find((definition) => definition.key === column.key);
      if (systemColumn) return mergeSystemColumn(systemColumn, column);
      return normalizeTemplateColumn(column);
    });
  const orderedKeys = new Set(ordered.map((column) => column.key));
  const missingRequiredColumns = REQUIRED_COLUMNS
    .filter((column) => !orderedKeys.has(column.key))
    .map((column) => mergeRequiredColumn(column));
  const missingSystemColumns = SYSTEM_EVALUATION_COLUMNS.filter((column) => !orderedKeys.has(column.key));
  for (const column of missingSystemColumns) {
    const normalized = mergeSystemColumn(column);
    if (column.key === 'assignee') {
      const assetsIndex = ordered.findIndex((item) => item.key === 'assets');
      if (assetsIndex >= 0) {
        ordered.splice(assetsIndex + 1, 0, normalized);
        continue;
      }
    }
    if (['compliance', 'findingDescription', 'findingSeverity'].includes(column.key)) {
      const statusIndex = ordered.findIndex((item) => item.key === 'status');
      if (statusIndex >= 0) {
        ordered.splice(statusIndex, 0, normalized);
        continue;
      }
    }
    ordered.push(normalized);
  }
  return [...ordered, ...missingRequiredColumns];
}
