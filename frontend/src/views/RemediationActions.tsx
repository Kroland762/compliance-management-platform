import { useEffect, useState } from 'react';
import { Button, DatePicker, Form, Input, message, Modal, Space, Table, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../utils/error';
import { useAuthStore } from '../store/auth';
import { DepartmentSelect, LookupSelect, PersonnelSelect } from '../components/lookups';

export default function RemediationActions() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(searchParams.has('riskId'));
  const [form] = Form.useForm();
  const user = useAuthStore((state) => state.user);
  const selectedRiskIds = Form.useWatch('riskIds', form) || [];
  const load = () => apiClient.get('/remediation-actions', { params: { pageSize: 100 } })
    .then((response: any) => setItems(response.data?.items || []));
  useEffect(() => {
    load();
    Promise.resolve().then(() => {
      const riskId = searchParams.get('riskId');
      if (riskId) form.setFieldValue('riskIds', [riskId]);
      if (user?.id) form.setFieldValue('ownerUserId', user.id);
      if (user?.primaryDepartmentId) {
        form.setFieldValue('ownerDepartmentId', user.primaryDepartmentId);
      }
    });
  }, []);

  const create = async (values: any) => {
    try {
      const response: any = await apiClient.post('/remediation-actions', {
        title: values.title,
        description: values.description,
        ownerUserId: values.ownerUserId,
        ownerDepartmentId: values.ownerDepartmentId,
        startDate: values.startDate?.format('YYYY-MM-DD'),
        dueDate: values.dueDate.format('YYYY-MM-DD'),
        riskLinks: values.riskIds.map((riskId: string) => ({
          riskId,
          isRequired: true,
          contributionDescription: values.riskContributions?.[riskId],
        })),
      });
      message.success('整改行动已创建');
      setOpen(false);
      navigate(`/remediation-actions/${response.data.id}`);
    } catch (error) {
      message.error(getApiErrorMessage(error, '创建失败'));
    }
  };

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>我的整改</Typography.Title>
          <Typography.Text type="secondary">一个整改行动可以同时服务多个风险，每个风险独立复核</Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.setFieldsValue({
              ownerUserId: user?.id,
              ownerDepartmentId: user?.primaryDepartmentId,
            });
            setOpen(true);
          }}
        >创建行动</Button>
      </Space>
      <Table
        rowKey="id"
        dataSource={items}
        onRow={(record) => ({ onClick: () => navigate(`/remediation-actions/${record.id}`), style: { cursor: 'pointer' } })}
        columns={[
          { title: '行动编号', dataIndex: 'code', width: 190 },
          { title: '行动', dataIndex: 'title' },
          { title: '关联风险', width: 100, render: (_, record) => record.riskLinks?.length || 0 },
          { title: '期限', dataIndex: 'dueDate', width: 120 },
          { title: '状态', dataIndex: 'status', width: 180, render: (value) => <Tag color={value === 'completed' ? 'green' : value === 'pending_verification' ? 'orange' : 'blue'}>{value}</Tag> },
        ]}
      />
      <Modal width={680} title="创建整改行动" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={create} preserve={false}>
          <Form.Item name="riskIds" label="关联风险" rules={[{ required: true, type: 'array', min: 1 }]}>
            <LookupSelect kind="risks" purpose="remediation-risk" mode="multiple" placeholder="输入风险标题检索" />
          </Form.Item>
          <Form.Item name="title" label="行动标题" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="执行说明" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
          {selectedRiskIds.map((riskId: string) => {
            return (
              <Form.Item
                key={riskId}
                name={['riskContributions', riskId]}
                label="对关联风险的整改贡献"
                rules={[{ required: true, message: '请分别说明该行动如何降低此风险' }]}
              >
                <Input.TextArea rows={2} placeholder="该说明只作用于当前风险的关联与复核" />
              </Form.Item>
            );
          })}
          <Space align="start">
            <Form.Item name="ownerDepartmentId" label="责任部门" rules={[{ required: true }]} style={{ width: 300 }}>
              <DepartmentSelect purpose="remediation-owner" />
            </Form.Item>
            <Form.Item name="ownerUserId" label="负责人" rules={[{ required: true }]} style={{ width: 300 }}>
              <PersonnelSelect purpose="remediation-owner" />
            </Form.Item>
          </Space>
          <Space align="start">
            <Form.Item name="startDate" label="开始日期"><DatePicker /></Form.Item>
            <Form.Item name="dueDate" label="完成期限" rules={[{ required: true }]}><DatePicker /></Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
