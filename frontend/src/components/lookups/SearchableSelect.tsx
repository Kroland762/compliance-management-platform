import { Select } from 'antd';
import type { SelectProps } from 'antd';

export default function SearchableSelect(props: SelectProps) {
  return <Select {...props} showSearch optionFilterProp="label" filterOption={(input, option) => String(option?.searchText || option?.label || '').toLocaleLowerCase().includes(input.trim().toLocaleLowerCase())} />;
}
