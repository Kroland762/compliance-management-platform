import type { SelectProps } from 'antd';
import LookupSelect from './LookupSelect';

export default function AuditorSelect(props: Omit<SelectProps, 'options'> & { purpose?: 'assessment-owner' | 'review-transfer'; contextId?: string }) {
  return <LookupSelect {...props} purpose={props.purpose || 'assessment-owner'} kind="auditors" placeholder={props.placeholder || '输入审计员姓名检索'} />;
}
