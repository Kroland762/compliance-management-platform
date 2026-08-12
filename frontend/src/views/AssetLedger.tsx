import { useEffect, useState } from 'react';
import { Button, Form, Input, message, Modal, Popconfirm, Segmented, Select, Space, Table, Tag, Typography } from 'antd';
import { EditOutlined, PlusOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';
import { getApiErrorMessage } from '../utils/error';

const criticality = {
  low: { label: '低', color: 'green' },
  medium: { label: '中', color: 'blue' },
  high: { label: '高', color: 'orange' },
  critical: { label: '关键', color: 'red' },
} as const;

type AssetStatusFilter = 'active' | 'archived' | 'all';

export default function AssetLedger() {
  const can = useAuthStore((state) => state.hasPermission);
  const canCreate = can('assets', 'create');
  const canUpdate = can('assets', 'update');
  const canArchive = can('assets', 'archive');
  const [items, setItems] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState<AssetStatusFilter>('active');
  const [departments, setDepartments] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [form] = Form.useForm();

  const load = async (
    page = pagination.current,
    pageSize = pagination.pageSize,
    status: AssetStatusFilter = statusFilter,
  ) => {
    setLoading(true);
    try {
      const response: any = await apiClient.get('/assets', {
        params: { page, pageSize, status: status === 'all' ? undefined : status },
      });
      setItems(response.data?.items || []);
      setPagination({ current: response.data?.pagination?.page || page, pageSize, total: response.data?.pagination?.total || 0 });
    } catch (error) {
      message.error(getApiErrorMessage(error, '加载资产失败'));
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

  const closeModal = () => {
    setOpen(false);
    setEditingAsset(null);
    form.resetFields();
  };

  const openCreateModal = () => {
    setEditingAsset(null);
    form.resetFields();
    form.setFieldsValue({ criticality: 'medium' });
    setOpen(true);
  };

  const openEditModal = (asset: any) => {
    setEditingAsset(asset);
    form.setFieldsValue({
      code: asset.code,
      name: asset.name,
      assetType: asset.assetType,
      criticality: asset.criticality,
      ownerDepartmentId: asset.ownerDepartmentId || undefined,
      ownerUserId: asset.ownerUserId || undefined,
      description: asset.description || undefined,
    });
    setOpen(true);
  };

  const submit = async (values: any) => {
    try {
      if (editingAsset) {
        const { code: _code, ...updates } = values;
        await apiClient.put(`/assets/${editingAsset.id}`, updates);
        message.success('资产已更新');
      } else {
        await apiClient.post('/assets', values);
        message.success('资产已创建');
      }
      closeModal();
      load(editingAsset ? pagination.current : 1);
    } catch (error) {
      message.error(getApiErrorMessage(error, editingAsset ? '更新资产失败' : '创建资产失败'));
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

  const restore = async (id: string) => {
    try {
      await apiClient.post(`/assets/${id}/restore`);
      message.success('资产已恢复');
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '恢复失败'));
    }
  };

  const changeStatusFilter = (value: string | number) => {
    const next = value as AssetStatusFilter;
    setStatusFilter(next);
    load(1, pagination.pageSize, next);
  };

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>资产台账</Typography.Title>
          <Typography.Text type="secondary">维护评估范围中的系统、应用、数据等实际管理对象</Typography.Text>
        </div>
        {canCreate && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>新增资产</Button>
        )}
      </Space>
      <Segmented
        value={statusFilter}
        onChange={changeStatusFilter}
        options={[
          { label: '使用中', value: 'active' },
          { label: '已归档', value: 'archived' },
          { label: '全部', value: 'all' },
        ]}
        style={{ marginBottom: 16 }}
      />
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
            width: 180,
            render: (_, record) => (
              <Space size={0}>
                {record.status === 'active' && canUpdate && (
                  <Button type="link" icon={<EditOutlined />} onClick={() => openEditModal(record)}>编辑</Button>
                )}
                {record.status === 'active' && canArchive && (
                  <Popconfirm title="归档后不能用于新的评估，确认归档？" onConfirm={() => archive(record.id)}>
                    <Button type="link" icon={<StopOutlined />}>归档</Button>
                  </Popconfirm>
                )}
                {record.status === 'archived' && canArchive && (
                  <Popconfirm title="恢复后可重新用于评估，确认恢复？" onConfirm={() => restore(record.id)}>
                    <Button type="link" icon={<ReloadOutlined />}>恢复</Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={editingAsset ? '编辑资产' : '新增资产'}
        open={open}
        onCancel={closeModal}
        onOk={() => form.submit()}
        okText={editingAsset ? '保存' : '创建'}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={submit} preserve={false}>
          <Form.Item name="code" label="资产编码" rules={[{ required: true }, { pattern: /^[A-Z0-9][A-Z0-9_-]{1,63}$/, message: '使用大写字母、数字、下划线或连字符' }]}>
            <Input disabled={Boolean(editingAsset)} placeholder="例如 CORE-BANKING" />
          </Form.Item>
          <Form.Item name="name" label="资产名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="assetType" label="资产类型" rules={[{ required: true }]}>
            <Select options={['system', 'application', 'data', 'infrastructure', 'process'].map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item name="criticality" label="关键性">
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
