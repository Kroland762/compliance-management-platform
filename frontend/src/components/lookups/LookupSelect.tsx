import { Button, Empty, Select, Space, Spin, Typography } from 'antd';
import type { SelectProps } from 'antd';
import { useMemo } from 'react';
import { useRemoteLookup } from './useRemoteLookup';
import type { LookupKind, LookupOption } from './types';

type Props = Omit<SelectProps, 'options' | 'onSearch' | 'filterOption'> & {
  kind: LookupKind;
  purpose: string;
  contextId?: string;
  optionLabel?: (option: LookupOption) => React.ReactNode;
  optionValue?: (option: LookupOption) => string;
};

function values(value: SelectProps['value']): string[] {
  if (Array.isArray(value)) return value.map(String);
  return value ? [String(value)] : [];
}

export default function LookupSelect({ kind, purpose, contextId, optionLabel, optionValue, value, loading: parentLoading, onPopupScroll, onOpenChange, ...props }: Props) {
  const selectedIds = useMemo(() => values(value), [value]);
  const lookup = useRemoteLookup({ kind, purpose, contextId, selectedIds });
  return (
    <Select
      {...props}
      value={value}
      showSearch
      filterOption={false}
      loading={Boolean(parentLoading) || lookup.loading}
      onSearch={lookup.search}
      onOpenChange={(open) => { if (open) lookup.open(); onOpenChange?.(open); }}
      onPopupScroll={(event) => {
        const target = event.target as HTMLElement;
        if (target.scrollTop + target.clientHeight >= target.scrollHeight - 24) lookup.loadMore();
        onPopupScroll?.(event);
      }}
      options={lookup.options.map((option) => ({
        ...option,
        value: optionValue ? optionValue(option) : option.value,
        label: optionLabel ? optionLabel(option) : option.label,
      }))}
      notFoundContent={lookup.loading ? <Spin size="small" /> : lookup.error ? (
        <Space direction="vertical" align="center"><Typography.Text type="danger">{lookup.error}</Typography.Text><Button size="small" onClick={lookup.retry}>重试</Button></Space>
      ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配结果" />}
    />
  );
}
