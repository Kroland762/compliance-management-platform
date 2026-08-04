import { useEffect, useState } from 'react';
import { Button, Form, Input, message, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { StopOutlined, PlusOutlined } from '@ant-design/icons';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../utils/error';

const criticality = {
  low: { label: '低', color: 'green' },
  medium: { label: '中', color: 'blue' },
  high: { label: '高', color: 'orange' },
  critical: { label: '关键', color: 'red' },
} as const;

export default function AssetLedger() {
  const [items, setItems] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [form] = Form.useForm();

  const load = async (page = pagination.current, pageSize = pagination.pageSize) => {
    setLoading(true);
    try {
      const response: any = await apiClient.get('/assets', { params: { page, pageSize } });
      setItems(response.data?.items || []);
      setPagination({ current: response.data?.pagination?.page || page, pageSize, total: response.data?.pagination?.total || 0 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
    Promise.all([apiClient.get('/lookup/departments'), apiClient.get('/lookup/personnel')]).then(([d, p]: any[]) => {
      setDepartments(d.data || []);
      setPeople(p.data || []);
    });
  }, []);

  const create = async (values: any) => {
    try {
      await apiClient.post('/assets', values);
      message.success('资产已创建');
      setOpen(false);
      form.resetFields();
      load(1);
    } catch (error) {
      message.error(getApiErrorMessage(error, '创建资产失败'));
    }
  };

  const archive = async (id: string) => {
    try {
      await apiClient.post(`/assets/${id}/archive`);
      message.success('资产已归档');
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '归档失败'));
    }
  };

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>资产台账</Typography.Title>
          <Typography.Text type="secondary">维护评估范围中的系统、应用、数据与组织级治理资产</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新增资产</Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        pagination={pagination}
        onChange={(next) => load(next.current, next.pageSize)}
        columns={[
          { title: '编码', dataIndex: 'code', width: 180 },
          { title: '名称', dataIndex: 'name' },
          { title: '类型', dataIndex: 'assetType', width: 140 },
          {
            title: '关键性',
            dataIndex: 'criticality',
            width: 100,
            render: (value: keyof typeof criticality) => <Tag color={criticality[value]?.color}>{criticality[value]?.label || value}</Tag>,
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (value) => <Tag color={value === 'active' ? 'green' : 'default'}>{value === 'active' ? '使用中' : '已归档'}</Tag>,
          },
          {
            title: '操作',
            width: 100,
            render: (_, record) => record.status === 'active' && record.code !== 'ORG-GOVERNANCE' ? (
              <Popconfirm title="归档后不能用于新的评估，确认归档？" onConfirm={() => archive(record.id)}>
                <Button type="link" icon={<StopOutlined />}>归档</Button>
              </Popconfirm>
            ) : null,
          },
        ]}
      />
      <Modal title="新增资产" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={create} preserve={false}>
          <Form.Item name="code" label="资产编码" rules={[{ required: true }, { pattern: /^[A-Z0-9][A-Z0-9_-]{1,63}$/, message: '使用大写字母、数字、下划线或连字符' }]}>
            <Input placeholder="例如 CORE-BANKING" />
          </Form.Item>
          <Form.Item name="name" label="资产名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="assetType" label="资产类型" rules={[{ required: true }]}>
            <Select options={['system', 'application', 'data', 'infrastructure', 'process'].map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item name="criticality" label="关键性" initialValue="medium">
            <Select options={Object.entries(criticality).map(([value, option]) => ({ value, label: option.label }))} />
          </Form.Item>
          <Form.Item name="ownerDepartmentId" label="责任部门">
            <Select allowClear options={departments.map((item) => ({ value: item.id, label: `${item.name} (${item.code})` }))} />
          </Form.Item>
          <Form.Item name="ownerUserId" label="负责人">
            <Select allowClear showSearch optionFilterProp="label" options={people.map((item) => ({ value: item.userId, label: item.displayName || item.username }))} />
          </Form.Item>
          <Form.Item name="description" label="说明"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
