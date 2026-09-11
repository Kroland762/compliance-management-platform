import type { SelectProps } from 'antd';
import LookupSelect from './LookupSelect';

export default function RoleSelect(props: Omit<SelectProps, 'options'> & { purpose?: string }) {
  return <LookupSelect {...props} purpose={props.purpose || 'user-membership'} kind="roles" placeholder={props.placeholder || '输入角色名称检索'} />;
}
