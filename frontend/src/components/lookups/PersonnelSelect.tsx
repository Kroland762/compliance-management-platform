import { Typography } from 'antd';
import type { SelectProps } from 'antd';
import LookupSelect from './LookupSelect';
import type { LookupOption } from './types';

export default function PersonnelSelect(props: Omit<SelectProps, 'options'> & { purpose: string; contextId?: string; valueType?: 'userId' | 'memberId' }) {
  const { valueType = 'userId', ...rest } = props;
  const render = (option: LookupOption) => {
    const username = String(option.meta?.username || '');
    return <span>{option.label}{username ? <Typography.Text type="secondary">（{username}）</Typography.Text> : null}</span>;
  };
  return <LookupSelect {...rest} kind="personnel" placeholder={props.placeholder || '输入姓名检索'} optionLabel={render}
    optionValue={valueType === 'memberId' ? (option) => String(option.meta?.memberId || option.value) : undefined} />;
}
