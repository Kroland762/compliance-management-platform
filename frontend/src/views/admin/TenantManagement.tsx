import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Modal, Form, Input, Select, Space, Tag, Popconfirm, App, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined, DeleteOutlined, StopOutlined, CheckCircleOutlined, UserOutlined } from '@ant-design/icons';
import apiClient from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { getApiErrorMessage } from '../../utils/error';

const { Text, Title } = Typography;

interface Tenant {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  status: 'active' | 'suspended';
  schemaName: string;
  createdAt: string;
}

export default function TenantManagement() {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const selectContext = useAuthStore((state) => state.selectContext);
  const refreshAuth = useAuthStore((state) => state.refreshToken);
  const [credentials, setCredentials] = useState<{ username: string; temporaryPassword: string } | null>(null);

  const enterTenant = async (tenant: Tenant) => {
    try {
      await selectContext(tenant.id);
      navigate('/users');
    } catch {
      message.error('租户上下文切换失败');
    }
  };

  const fetchTenants = async () => {
    setLoading(true);
    try {
      const res: any = await apiClient.get('/tenants');
      setTenants(res.data?.items || []);
    } catch {
      message.error('加载租户列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTenants(); }, []);

  const handleCreate = async (values: any) => {
    try {
      const res: any = await apiClient.post('/tenants', values);
      message.success(res.message || '租户创建成功');
      setCredentials(res.data?.bootstrapCredentials || null);
      setModalOpen(false);
      form.resetFields();
      await refreshAuth();
      fetchTenants();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '创建失败'));
    }
  };

  const handleUpdate = async (values: any) => {
    if (!editingTenant) return;
    try {
      await apiClient.put(`/tenants/${editingTenant.id}`, values);
      message.success('租户已更新');
      setModalOpen(false);
      setEditingTenant(null);
      form.resetFields();
      fetchTenants();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '更新失败'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res: any = await apiClient.delete(`/tenants/${id}`);
      message.success(res.message || '租户已删除');
      fetchTenants();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '删除失败'));
    }
  };

  const openCreate = () => {
    setEditingTenant(null);
    form.resetFields();
    form.setFieldsValue({ status: 'active' });
    setModalOpen(true);
  };

  const openEdit = (tenant: Tenant) => {
    setEditingTenant(tenant);
    form.setFieldsValue({ name: tenant.name, domain: tenant.domain, status: tenant.status });
    setModalOpen(true);
  };

  const columns = [
    {
      title: '租户名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Tenant) => (
        <Space>
          <Text strong>{text}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>({record.slug})</Text>
        </Space>
      ),
    },
    {
      title: 'Schema',
      dataIndex: 'schemaName',
      key: 'schemaName',
      render: (text: string) => <Tag>{text}</Tag>,
    },
    {
      title: '域名',
      dataIndex: 'domain',
      key: 'domain',
      render: (text: string | null) => text || <Text type="secondary">未设置</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) =>
        status === 'active' ? (
          <Tag icon={<CheckCircleOutlined />} color="success">运行中</Tag>
        ) : (
          <Tag icon={<StopOutlined />} color="error">已停用</Tag>
        ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (text: string) => new Date(text).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: Tenant) => (
        <Space>
          <Button type="primary" size="small" icon={<UserOutlined />}
            onClick={() => enterTenant(record)}>
            查看用户
          </Button>
          <Button type="link" size="small" onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm
            title="确定删除此租户？"
            description="将停用该租户并保留数据 schema；停用用户会被拒绝访问。"
            onConfirm={() => handleDelete(record.id)}
            okText="确认删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>停用</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '0 0 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>平台管理</Title>
          <Text type="secondary">管理平台租户；进入租户后才能查看和操作该租户的业务数据。</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchTenants}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建租户</Button>
        </Space>
      </div>

      <Table
        dataSource={tenants}
        columns={columns}
        size="small"
        rowKey="id"
        loading={loading}
        pagination={false}
        style={{ background: '#fff', borderRadius: 12, overflow: 'hidden' }}
      />

      <Modal
        title={editingTenant ? '编辑租户' : '新建租户'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditingTenant(null); form.resetFields(); }}
        onOk={() => form.submit()}
        okText={editingTenant ? '保存' : '创建'}
      >
        <Form form={form} layout="vertical" onFinish={editingTenant ? handleUpdate : handleCreate}>
          <Form.Item name="name" label="租户名称" rules={[{ required: true, message: '请输入租户名称' }]}>
            <Input placeholder="例如：技术部" disabled={!!editingTenant} />
          </Form.Item>
          {!editingTenant && (
            <>
              <Form.Item name="slug" label="租户标识" rules={[
                { required: true, message: '请输入租户标识' },
                { pattern: /^[a-z][a-z0-9_]*$/, message: '仅小写字母/数字/下划线，字母开头' },
              ]}>
                <Input placeholder="例如：tech" />
              </Form.Item>
              <Form.Item name={['admin', 'username']} label="首位管理员用户名" rules={[{ required: true }]}>
                <Input autoComplete="off" />
              </Form.Item>
              <Form.Item name={['admin', 'displayName']} label="首位管理员姓名" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name={['admin', 'email']} label="首位管理员邮箱">
                <Input />
              </Form.Item>
            </>
          )}
          <Form.Item name="domain" label="域名（可选）">
            <Input placeholder="例如：tech.audit.example.com" />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select>
              <Select.Option value="active">运行中</Select.Option>
              <Select.Option value="suspended">已停用</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="首位管理员一次性凭据"
        open={Boolean(credentials)}
        closable={false}
        maskClosable={false}
        okText="我已安全保存"
        cancelButtonProps={{ style: { display: 'none' } }}
        onOk={() => setCredentials(null)}
      >
        <Text type="warning">此临时密码关闭后无法再次查看，首次登录必须修改。</Text>
        <div style={{ marginTop: 16 }}>
          <Input value={credentials?.username} readOnly addonBefore="用户名" />
          <Input.TextArea value={credentials?.temporaryPassword} readOnly autoSize style={{ marginTop: 8 }} />
        </div>
      </Modal>
    </div>
  );
}
