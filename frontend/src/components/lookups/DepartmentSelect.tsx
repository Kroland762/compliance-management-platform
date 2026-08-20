import type { SelectProps } from 'antd';
import LookupSelect from './LookupSelect';

export default function DepartmentSelect(props: Omit<SelectProps, 'options'> & { purpose: string; contextId?: string }) {
  return <LookupSelect {...props} kind="departments" placeholder={props.placeholder || '输入部门名称检索'} />;
}
