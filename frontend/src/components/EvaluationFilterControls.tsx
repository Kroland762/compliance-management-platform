import { FilterFilled, FilterOutlined } from '@ant-design/icons';
import { Button, Input, Popover, Select, Space, Typography } from 'antd';
import type { ReactNode } from 'react';
import type { DynamicEvaluationFilter } from '../utils/evaluationFilters';

export function ColumnFilterButton({ label, active, children }: { label: string; active: boolean; children: ReactNode }) {
  return <Space size={4}>
    <span>{label}</span>
    <Popover trigger="click" placement="bottom" content={children}>
      <Button
        type="text"
        size="small"
        aria-label={`筛选 ${label}`}
        icon={active ? <FilterFilled style={{ color: '#1677ff' }} /> : <FilterOutlined />}
      />
    </Popover>
  </Space>;
}

export function TextColumnFilter({ value, placeholder, exact, onChange }: {
  value?: string; placeholder: string; exact?: boolean; onChange: (value?: string) => void;
}) {
  return <Space direction="vertical" size={6} style={{ width: 240 }}>
    <Typography.Text type="secondary">{exact ? '精确匹配' : '包含关键词'}</Typography.Text>
    <Input allowClear value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value || undefined)} />
  </Space>;
}

export function MultiColumnFilter({ value, options, placeholder, onChange }: {
  value?: string[]; options: Array<{ label: string; value: string }>; placeholder: string; onChange: (value?: string[]) => void;
}) {
  return <Select
    mode="multiple"
    allowClear
    showSearch
    maxTagCount="responsive"
    style={{ width: 280 }}
    value={value || []}
    options={options}
    placeholder={placeholder}
    onChange={(selected) => onChange(selected.length ? selected : undefined)}
  />;
}

export function PresenceColumnFilter({ value, onChange, presentLabel = '有', absentLabel = '无' }: {
  value?: string; onChange: (value?: 'present' | 'absent') => void; presentLabel?: string; absentLabel?: string;
}) {
  return <Select allowClear style={{ width: 220 }} value={value} placeholder="全部"
    options={[{ value: 'present', label: presentLabel }, { value: 'absent', label: absentLabel }]}
    onChange={(selected) => onChange(selected as 'present' | 'absent' | undefined)} />;
}

const EMPTY_VALUE = '__evaluation_empty__';

export function DynamicColumnFilterControl({ definition, value, onChange }: {
  definition: { mode: 'select' | 'text'; options?: string[]; hasEmpty: boolean };
  value?: DynamicEvaluationFilter;
  onChange: (value?: DynamicEvaluationFilter) => void;
}) {
  if (definition.mode === 'select') {
    const selected = value?.operator === 'in'
      ? [...value.values, ...(value.includeEmpty ? [EMPTY_VALUE] : [])]
      : [];
    const options = [
      ...(definition.options || []).map((item) => ({ label: item, value: item })),
      ...(definition.hasEmpty ? [{ label: '（空值）', value: EMPTY_VALUE }] : []),
    ];
    return <MultiColumnFilter value={selected} options={options} placeholder="选择列值" onChange={(items) => {
      const normalized = items || [];
      const values = normalized.filter((item) => item !== EMPTY_VALUE);
      const includeEmpty = normalized.includes(EMPTY_VALUE);
      onChange(values.length || includeEmpty ? { operator: 'in', values, includeEmpty } : undefined);
    }} />;
  }
  return <Space direction="vertical" size={8} style={{ width: 260 }}>
    <Input allowClear value={value?.operator === 'contains' ? value.value : undefined} placeholder="包含关键词"
      onChange={(event) => onChange(event.target.value ? { operator: 'contains', value: event.target.value } : undefined)} />
    {definition.hasEmpty && <Select allowClear style={{ width: '100%' }} placeholder="空值条件"
      value={value?.operator === 'empty' ? String(value.value) : undefined}
      options={[{ value: 'true', label: '仅空值' }, { value: 'false', label: '仅非空值' }]}
      onChange={(selected) => onChange(selected === undefined ? undefined : { operator: 'empty', value: selected === 'true' })} />}
  </Space>;
}
