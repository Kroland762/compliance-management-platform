import { useState, useEffect } from 'react';
import { Typography, Table, Button, Modal, Form, Input, Checkbox, Card, App, Space, Tag, Popconfirm, Spin } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';

const { Title, Text } = Typography;

interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: Record<string, string[]>;
  isSystem: boolean;
}

interface PermDef {
  [resource: string]: string[];
}

const RESOURCE_LABELS: Record<string, string> = {
  users: '用户管理',
  templates: '模版管理',
  tasks: '合规任务',
  risks: '风险管理',
  audit_logs: '操作日志',
  notifications: '通知管理',
  export: '数据导出',
  settings: '安全设置',
  data_sources: '数据源管理',
  rules: '规则管理',
  account_tasks: '账户审计任务',
  problems: '问题管理',
  dashboard: '审计概览',
};

const ACTION_LABELS: Record<string, string> = {
  create: '创建', read: '查看', update: '更新', delete: '删除',
  submit: '提交', return: '退回', export: '导出', sync: '同步',
  toggle: '启/停', execute: '执行',
};

export default function RoleManagement() {
  const { message } = App.useApp();
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.permissions?.users?.includes('create');
  const [roles, setRoles] = useState<Role[]>([]);
  const [permDefs, setPermDefs] = useState<PermDef>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [rolesRes, defsRes]: any[] = await Promise.all([
        apiClient.get('/roles'),
        apiClient.get('/roles/permission-defs'),
      ]);
      setRoles(rolesRes.data);
      setPermDefs(defsRes.data);
    } catch {
      message.error('加载角色数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const openCreate = () => {
    setEditingRole(null);
    form.resetFields();
    // Reset all permission checkboxes
    for (const resource of Object.keys(permDefs)) {
      form.setFieldsValue({ [`perm_${resource}`]: [] });
    }
    setModalOpen(true);
  };

  const openEdit = (role: Role) => {
    setEditingRole(role);
    form.setFieldsValue({ name: role.name, description: role.description });
    for (const [resource, actions] of Object.entries(role.permissions)) {
      form.setFieldsValue({ [`perm_${resource}`]: actions });
    }
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      // Build permissions object from form fields
      const permissions: Record<string, string[]> = {};
      for (const resource of Object.keys(permDefs)) {
        const actions = values[`perm_${resource}`] || [];
        if (actions.length > 0) {
          permissions[resource] = actions;
        }
      }

      const body = { name: values.name, description: values.description, permissions };

      if (editingRole) {
        await apiClient.put(`/roles/${editingRole.id}`, body);
        message.success('角色已更新');
      } else {
        await apiClient.post('/roles', body);
        message.success('角色已创建');
      }

      setModalOpen(false);
      fetchData();
    } catch (err: any) {
      if (err?.error?.message) message.error(err.error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/roles/${id}`);
      message.success('角色已删除');
      fetchData();
    } catch (err: any) {
      message.error(err?.error?.message || '删除失败');
    }
  };

  const columns = [
    { title: '角色名称', dataIndex: 'name', width: 140, render: (v: string, r: Role) => (
      <><SafetyCertificateOutlined style={{ marginRight: 6, color: r.isSystem ? '#5856D6' : '#007AFF' }} />{v}</>
    )},
    { title: '描述', dataIndex: 'description', ellipsis: true },
    { title: '类型', dataIndex: 'isSystem', width: 80, render: (v: boolean) => (
      <Tag color={v ? 'purple' : 'blue'}>{v ? '系统内置' : '自定义'}</Tag>
    )},
    { title: '权限数', width: 80, render: (_: any, r: Role) => {
      const count = Object.values(r.permissions).reduce((sum, arr) => sum + arr.length, 0);
      return count;
    }},
    ...(isAdmin ? [
      { title: '操作', width: 140, render: (_: any, r: Role) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          {!r.isSystem && (
            <Popconfirm title="确定删除此角色？" onConfirm={() => handleDelete(r.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      )},
    ] : []),
  ];

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 120 }}><Spin size="large" /></div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
        </div>
        {isAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ borderRadius: 10, height: 40 }}>
            新建角色
          </Button>
        )}
      </div>

      <Table
        dataSource={roles}
        columns={columns}
        size="small"
        rowKey="id"
        pagination={false}
        style={{ background: '#fff', borderRadius: 16 }}
      />

      <Modal
        title={editingRole ? '编辑角色' : '新建角色'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        width={720}
        destroyOnClose
        style={{ top: 20 }}
      >
        <Form form={form} layout="vertical" style={{ maxHeight: '60vh', overflow: 'auto', paddingRight: 4 }}>
          <Form.Item name="name" label="角色名称" rules={[{ required: true, message: '请输入角色名称' }]}>
            <Input placeholder="例如：只读审计员" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="角色描述（可选）" />
          </Form.Item>

          <Text strong style={{ display: 'block', marginBottom: 12, fontSize: 14 }}>权限配置</Text>
          <Card size="small" style={{ background: '#F9F9FB', borderRadius: 10, border: 'none' }}>
            {Object.entries(permDefs).map(([resource, actions]) => (
              <div key={resource} style={{ marginBottom: 12 }}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                  {RESOURCE_LABELS[resource] || resource}
                </Text>
                <Form.Item name={`perm_${resource}`} noStyle>
                  <Checkbox.Group>
                    <Space wrap>
                      {actions.map(action => (
                        <Checkbox key={action} value={action} style={{ fontSize: 13 }}>
                          {ACTION_LABELS[action] || action}
                        </Checkbox>
                      ))}
                    </Space>
                  </Checkbox.Group>
                </Form.Item>
              </div>
            ))}
          </Card>
        </Form>
      </Modal>
    </div>
  );
}
