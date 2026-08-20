import { useEffect, useState } from 'react';
import { Button, DatePicker, Form, Input, message, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../utils/error';
import { useAuthStore } from '../store/auth';
import { RISK_LEVEL } from '../constants/status';
import { DepartmentSelect, PersonnelSelect } from '../components/lookups';

const statusMap: Record<string, { text: string; color: string }> = {
  open: { text: '待处置', color: 'orange' }, remediating: { text: '整改中', color: 'blue' },
  escalated: { text: '已升级风险', color: 'purple' }, resolved: { text: '已解决', color: 'green' },
  cancelled: { text: '已取消', color: 'default' },
};

export default function Findings({ taskId }: { taskId?: string }) {
  const can = useAuthStore((state) => state.hasPermission);
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [remediating, setRemediating] = useState<any>();
  const [riskOpen, setRiskOpen] = useState(false);
  const [remediationForm] = Form.useForm();
  const [riskForm] = Form.useForm();
  const load = async () => {
    const response: any = await apiClient.get('/findings', { params: { pageSize: 100, taskId } });
    setItems(response.data?.items || []);
  };
  useEffect(() => {
    void load();
  }, [taskId]);

  const createRemediation = async (values: any) => {
    try {
      await apiClient.post(`/findings/${remediating.id}/remediate`, {
        title: values.title, description: values.description,
        ownerDepartmentId: values.ownerDepartmentId, ownerUserId: values.ownerUserId,
        dueDate: values.dueDate.format('YYYY-MM-DD'),
      }, { headers: { 'If-Match': `"${remediating.lockVersion}"`, 'Idempotency-Key': crypto.randomUUID() } });
      message.success('整改行动已创建');
      setRemediating(undefined);
      await load();
    } catch (error) { message.error(getApiErrorMessage(error, '创建整改失败')); }
  };
  const escalate = async (values: any) => {
    try {
      await apiClient.post('/findings/escalate', {
        findingIds: selected,
        title: values.title, description: values.description, riskLevel: values.riskLevel,
        treatmentStrategy: values.treatmentStrategy, ownerDepartmentId: values.ownerDepartmentId,
        ownerUserId: values.ownerUserId, dueDate: values.dueDate?.format('YYYY-MM-DD'),
      }, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
      message.success('不符合项已升级为风险');
      setSelected([]);
      setRiskOpen(false);
      await load();
    } catch (error) { message.error(getApiErrorMessage(error, '升级风险失败')); }
  };
  const openRemediation = (item: any) => {
    setRemediating(item);
    remediationForm.setFieldsValue({
      title: `整改：${item.title}`, description: item.description,
      ownerDepartmentId: item.ownerDepartmentId, ownerUserId: item.ownerUserId,
    });
  };

  return (
    <div>
      {!taskId && <>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>不符合项</Typography.Title>
        <Typography.Text type="secondary">复核为部分符合或不符合的评估单元会自动生成唯一记录</Typography.Text>
      </>}
      <Space style={{ width: '100%', justifyContent: 'flex-end', margin: taskId ? '0 0 12px' : '20px 0 12px' }}>
        {can('findings', 'escalate') && <Button type="primary" disabled={!selected.length} onClick={() => {
          const first = items.find((item) => item.id === selected[0]);
          riskForm.setFieldsValue({ ownerDepartmentId: first?.ownerDepartmentId, ownerUserId: first?.ownerUserId, treatmentStrategy: 'mitigate', riskLevel: first?.severity });
          setRiskOpen(true);
        }}>升级为风险（{selected.length}）</Button>}
      </Space>
      <Table rowKey="id" dataSource={items} rowSelection={can('findings', 'escalate') ? {
        selectedRowKeys: selected, onChange: setSelected,
        getCheckboxProps: (item: any) => ({ disabled: item.disposition !== 'pending' }),
      } : undefined} columns={[
        { title: '编号', dataIndex: 'code', width: 180 }, { title: '不符合项', dataIndex: 'title' },
        { title: '严重度', dataIndex: 'severity', width: 90, render: (value: string) => <Tag color={RISK_LEVEL[value]?.color}>{RISK_LEVEL[value]?.text || value}</Tag> },
        { title: '来源控制项', width: 200, render: (_: any, item: any) => item.evaluation ? `${item.evaluation.sequenceNumber} · ${item.evaluation.controlDomain}` : '-' },
        { title: '期限', dataIndex: 'dueDate', width: 110 },
        { title: '状态', dataIndex: 'status', width: 120, render: (value: string) => <Tag color={statusMap[value]?.color}>{statusMap[value]?.text || value}</Tag> },
        { title: '处置', width: 110, render: (_: any, item: any) => can('findings', 'remediate') && item.disposition === 'pending' ? <Button size="small" onClick={() => openRemediation(item)}>直接整改</Button> : '-' },
      ]} />
      <Modal title="创建直接整改行动" open={Boolean(remediating)} onCancel={() => setRemediating(undefined)} onOk={() => remediationForm.submit()}>
        <Form form={remediationForm} layout="vertical" onFinish={createRemediation}>
          <Form.Item name="title" label="整改标题" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="整改措施" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="ownerDepartmentId" label="责任部门" rules={[{ required: true }]}><DepartmentSelect purpose="finding-remediation-owner" contextId={remediating?.id} /></Form.Item>
          <Form.Item name="ownerUserId" label="责任人" rules={[{ required: true }]}><PersonnelSelect purpose="finding-remediation-owner" contextId={remediating?.id} /></Form.Item>
          <Form.Item name="dueDate" label="整改期限" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
      <Modal title="升级为风险" width={650} open={riskOpen} onCancel={() => setRiskOpen(false)} onOk={() => riskForm.submit()}>
        <Form form={riskForm} layout="vertical" onFinish={escalate}>
          <Form.Item name="title" label="风险标题" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="风险描述" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
          <Space align="start">
            <Form.Item name="riskLevel" label="风险等级" rules={[{ required: true }]}><Select style={{ width: 140 }} options={Object.entries(RISK_LEVEL).map(([value, item]) => ({ value, label: item.text }))} /></Form.Item>
            <Form.Item name="treatmentStrategy" label="处置策略"><Select style={{ width: 140 }} options={[{ value: 'mitigate', label: '降低' }, { value: 'accept', label: '接受' }, { value: 'avoid', label: '规避' }, { value: 'transfer', label: '转移' }]} /></Form.Item>
            <Form.Item name="dueDate" label="处置期限"><DatePicker /></Form.Item>
          </Space>
          <Form.Item name="ownerDepartmentId" label="责任部门" rules={[{ required: true }]}><DepartmentSelect purpose="finding-escalation-owner" /></Form.Item>
          <Form.Item name="ownerUserId" label="负责人" rules={[{ required: true }]}><PersonnelSelect purpose="finding-escalation-owner" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
