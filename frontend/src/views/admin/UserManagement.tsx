import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Table, Button, Modal, Form, Input, Select, Space, message, Popconfirm, Typography, Card, Tag, Breadcrumb } from 'antd';
import { PlusOutlined, StopOutlined, CheckCircleOutlined, EditOutlined, SearchOutlined, SafetyOutlined, HomeOutlined } from '@ant-design/icons';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../utils/error';
import { useAuthStore } from '../../store/auth';

const { Title, Text } = Typography;

interface Role {
  id: string;
  name: string;
  isSystem: boolean;
}

export default function UserManagement() {
  const [searchParams] = useSearchParams();
  const urlTenantId = searchParams.get('tenantId') || '';
  const urlTenantName = searchParams.get('tenantName') || '';

  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [filters, setFilters] = useState({ roleId: '', status: '', keyword: '' });
  const canManage = useAuthStore(s => s.hasPermission('users', 'create'));
  const currentTenantId = useAuthStore(s => s.user?.tenantId);

  const fetchRoles = async () => {
    try {
      const res: any = await apiClient.get('/roles');
      setRoles(res.data || []);
    } catch {}
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      // URL tenant param (super admin viewing a specific tenant)
      if (urlTenantId) params.set('tenantId', urlTenantId);
      if (filters.roleId) params.set('roleId', filters.roleId);
      if (filters.status) params.set('isActive', filters.status === 'active' ? 'true' : 'false');
      if (filters.keyword) params.set('keyword', filters.keyword);
      const qs = params.toString();
      const res: any = await apiClient.get(`/users${qs ? '?' + qs : ''}`);
      setUsers(res.data?.items || []);
    } finally { setLoading(false); }
  };

  const tenantLabel = useMemo(() => {
    if (urlTenantName) return urlTenantName;
    if (currentTenantId) return '本租户';
    return null;
  }, [urlTenantName, currentTenantId]);

  useEffect(() => { fetchRoles(); }, []);
  useEffect(() => { fetchUsers(); }, [filters, urlTenantId]);

  const handleCreate = async (values: any) => {
    try {
      await apiClient.post('/users', values);
      message.success('用户创建成功');
      setModalVisible(false);
      form.resetFields();
      fetchUsers();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '创建失败'));
    }
  };

  const handleEdit = (record: any) => {
    setEditingUser(record);
    editForm.setFieldsValue({ department: record.department, email: record.email, roleId: record.roleId });
    setEditVisible(true);
  };

  const handleUpdate = async (values: any) => {
    try {
      await apiClient.put(`/users/${editingUser.id}`, values);
      message.success('用户信息已更新');
      setEditVisible(false);
      setEditingUser(null);
      fetchUsers();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '更新失败'));
    }
  };

  const handleDisable = async (id: string) => {
    try {
      await apiClient.delete(`/users/${id}`);
      message.success('用户已禁用');
      fetchUsers();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '操作失败'));
    }
  };

  const handleEnable = async (id: string) => {
    try {
      await apiClient.put(`/users/${id}`, { isActive: true });
      message.success('用户已启用');
      fetchUsers();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '操作失败'));
    }
  };

  const columns = [
    { title: '用户名', dataIndex: 'username' },
    { title: '部门', dataIndex: 'department' },
    { title: '邮箱', dataIndex: 'email', render: (v: string) => v || '-' },
    { title: '角色', dataIndex: 'roleName', render: (v: string) => v || '-' },
    { title: '状态', dataIndex: 'isActive', render: (v: boolean) => v ? '启用' : '禁用' },
    { title: '创建时间', dataIndex: 'createdAt', render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
    { title: '最后登录', dataIndex: 'lastLogin', render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    ...(canManage ? [{
      title: '操作', render: (_: any, record: any) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          {record.isActive ? (
            <Popconfirm title="确定禁用该用户？" okText="确认" cancelText="取消" onConfirm={() => handleDisable(record.id)}>
              <Button size="small" danger icon={<StopOutlined />}>禁用</Button>
            </Popconfirm>
          ) : (
            <Popconfirm title="确定启用该用户？" okText="确认" cancelText="取消" onConfirm={() => handleEnable(record.id)}>
              <Button size="small" type="primary" icon={<CheckCircleOutlined />}>启用</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    }] : []),
  ];

  return (
    <div>
      {tenantLabel && (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tag icon={<HomeOutlined />} color="blue" style={{ fontSize: 14, padding: '4px 12px' }}>
            {tenantLabel}
          </Tag>
        </div>
      )}
      <div className="filter-toolbar">
        <div className="filter-toolbar-content">
          <Input
            placeholder="搜索用户名"
            prefix={<SearchOutlined style={{ color: '#AEAEB2' }} />}
            value={filters.keyword}
            onChange={e => setFilters(f => ({ ...f, keyword: e.target.value }))}
            allowClear
            style={{ width: 200 }}
          />
          <Select
            placeholder="角色"
            value={filters.roleId || undefined}
            onChange={v => setFilters(f => ({ ...f, roleId: v || '' }))}
            allowClear
            style={{ width: 140 }}
            options={roles.map(r => ({ value: r.id, label: r.name }))}
          />
          <Select
            placeholder="状态"
            value={filters.status || undefined}
            onChange={v => setFilters(f => ({ ...f, status: v || '' }))}
            allowClear
            style={{ width: 100 }}
            options={[
              { value: 'active', label: '启用' },
              { value: 'inactive', label: '禁用' },
            ]}
          />
          {canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>创建用户</Button>
          )}
        </div>
      </div>
      <Table columns={columns} dataSource={users} rowKey="id" loading={loading} size="small" />

      {/* 创建用户 */}
      <Modal title="创建用户" open={modalVisible} onCancel={() => setModalVisible(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[
            { required: true, message: '请输入密码' },
            { min: 8, message: '密码长度不能少于 8 位' },
            { pattern: /[a-z]/, message: '必须包含小写字母' },
            { pattern: /[A-Z]/, message: '必须包含大写字母' },
            { pattern: /[0-9]/, message: '必须包含数字' },
            { pattern: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/, message: '必须包含特殊字符' },
          ]}>
            <Input.Password />
          </Form.Item>
          <Card size="small" style={{ marginBottom: 16, background: '#F9F9FB', borderRadius: 10, border: 'none' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              <SafetyOutlined style={{ marginRight: 4 }} />
              密码要求：8位以上，含大写字母、小写字母、数字和特殊字符
            </Text>
          </Card>
          <Form.Item name="email" label="邮箱">
            <Input />
          </Form.Item>
          <Form.Item name="department" label="部门">
            <Input />
          </Form.Item>
          <Form.Item name="roleId" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select options={roles.map(r => ({ value: r.id, label: r.name }))} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑用户 */}
      <Modal title={`编辑用户 - ${editingUser?.username || ''}`} open={editVisible}
        onCancel={() => { setEditVisible(false); setEditingUser(null); }} onOk={() => editForm.submit()}>
        <Form form={editForm} layout="vertical" onFinish={handleUpdate}>
          <Form.Item name="department" label="部门">
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input />
          </Form.Item>
          <Form.Item name="roleId" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select options={roles.map(r => ({ value: r.id, label: r.name }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
