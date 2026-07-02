import { useEffect, useState } from 'react';
import { App, Button, Card, Empty, Input, InputNumber, Popconfirm, Select, Space, Spin, Table, Tag, Tooltip, Tree } from 'antd';
import { ApartmentOutlined, CloseOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';

interface DepartmentNode {
  id: string;
  name: string;
  parentId: string | null;
  description: string | null;
  sortOrder: number;
  memberCount: number;
  children: DepartmentNode[];
}

interface UserOption {
  id: string;
  username: string;
  email?: string | null;
  department?: string | null;
  roleName?: string | null;
  createdAt?: string | null;
  lastLogin?: string | null;
  isActive: boolean;
}

function flattenDepartments(items: DepartmentNode[]): DepartmentNode[] {
  return items.flatMap((item) => [item, ...flattenDepartments(item.children || [])]);
}

function toTreeData(items: DepartmentNode[]): any[] {
  return items.map((item) => ({
    key: item.id,
    title: `${item.name}${item.memberCount ? ` (${item.memberCount})` : ''}`,
    children: toTreeData(item.children || []),
  }));
}

function getSiblingDepartments(items: DepartmentNode[], parentId: string | null) {
  return flattenDepartments(items).filter((item) => item.parentId === parentId);
}

function getUniqueDepartmentName(items: DepartmentNode[], parentId: string | null) {
  const existingNames = new Set(getSiblingDepartments(items, parentId).map((item) => item.name));
  const baseName = '新部门';
  if (!existingNames.has(baseName)) return baseName;

  let index = 2;
  while (existingNames.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
}

export default function OrganizationManagement() {
  const { message } = App.useApp();
  const can = useAuthStore((s) => s.hasPermission);
  const canManage = can('organization', 'create') || can('organization', 'update') || can('organization', 'delete');
  const canReadOrganization = can('organization', 'read');
  const [departments, setDepartments] = useState<DepartmentNode[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [deptDraft, setDeptDraft] = useState({ name: '', parentId: '', description: '', sortOrder: 0 });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedDept = selectedDeptId ? flattenDepartments(departments).find((item) => item.id === selectedDeptId) || null : null;

  const fetchOrganization = async (preferredDeptId = selectedDeptId) => {
    if (!canReadOrganization) return;
    setLoading(true);
    try {
      const [deptRes, userRes]: any[] = await Promise.all([
        apiClient.get('/departments'),
        apiClient.get('/users', { params: { pageSize: 100, isActive: true } }),
      ]);
      const nextDepartments = deptRes.data || [];
      setDepartments(nextDepartments);
      setUsers(userRes.data?.items || userRes.data?.users || []);
      const flat = flattenDepartments(nextDepartments);
      const nextSelectedId = preferredDeptId && flat.some((item) => item.id === preferredDeptId)
        ? preferredDeptId
        : flat[0]?.id || null;
      setSelectedDeptId(nextSelectedId);
      if (nextSelectedId) {
        const nextSelectedDept = flat.find((item) => item.id === nextSelectedId);
        if (nextSelectedDept) {
          setDeptDraft({
            name: nextSelectedDept.name,
            parentId: nextSelectedDept.parentId || '',
            description: nextSelectedDept.description || '',
            sortOrder: nextSelectedDept.sortOrder || 0,
          });
        }
        const memberRes: any = await apiClient.get(`/departments/${nextSelectedId}/members`);
        setSelectedMemberIds((memberRes.data || []).map((user: UserOption) => user.id));
      } else {
        setDeptDraft({ name: '', parentId: '', description: '', sortOrder: 0 });
        setSelectedMemberIds([]);
      }
    } catch (err: any) {
      message.error(err?.error?.message || '加载组织数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOrganization(); }, [canReadOrganization]);

  const handleSelectDepartment = async (keys: React.Key[]) => {
    const id = String(keys[0] || '');
    if (!id) return;
    setSelectedDeptId(id);
    const dept = flattenDepartments(departments).find((item) => item.id === id);
    if (dept) {
      setDeptDraft({
        name: dept.name,
        parentId: dept.parentId || '',
        description: dept.description || '',
        sortOrder: dept.sortOrder || 0,
      });
    }
    try {
      const res: any = await apiClient.get(`/departments/${id}/members`);
      setSelectedMemberIds((res.data || []).map((user: UserOption) => user.id));
    } catch {
      message.error('加载部门成员失败');
    }
  };

  const handleCreateDepartment = async (parentId: string | null = null, successText?: string) => {
    if (!can('organization', 'create')) return;
    setSaving(true);
    try {
      const res: any = await apiClient.post('/departments', {
        name: getUniqueDepartmentName(departments, parentId),
        parentId,
        sortOrder: 0,
      });
      message.success(successText || (parentId ? '子部门已创建' : '部门已创建'));
      setSelectedDeptId(res.data.id);
      await fetchOrganization(res.data.id);
    } catch (err: any) {
      message.error(err?.error?.message || '创建部门失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDepartment = async () => {
    if (!can('organization', 'update') || !selectedDeptId) return;
    setSaving(true);
    try {
      const name = deptDraft.name.trim();
      if (!name) {
        message.error('请输入部门名称');
        return;
      }
      await apiClient.put(`/departments/${selectedDeptId}`, {
        name,
        parentId: deptDraft.parentId || null,
        description: deptDraft.description.trim() || null,
        sortOrder: deptDraft.sortOrder || 0,
      });
      await apiClient.put(`/departments/${selectedDeptId}/members`, { userIds: selectedMemberIds });
      message.success('组织权限已更新');
      await fetchOrganization(selectedDeptId);
    } catch (err: any) {
      if (err?.error?.message) message.error(err.error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDepartment = async () => {
    if (!can('organization', 'delete') || !selectedDeptId) return;
    setSaving(true);
    try {
      await apiClient.delete(`/departments/${selectedDeptId}`);
      message.success('部门已删除');
      setSelectedDeptId(null);
      await fetchOrganization();
    } catch (err: any) {
      message.error(err?.error?.message || '删除部门失败');
    } finally {
      setSaving(false);
    }
  };

  const cardStyle: React.CSSProperties = { borderRadius: 16, border: '0.5px solid rgba(0,0,0,0.08)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };
  const btnStyle: React.CSSProperties = { height: 40, borderRadius: 10, fontWeight: 500, paddingLeft: 28, paddingRight: 28 };
  const hintStyle: React.CSSProperties = { fontSize: 13, color: '#8E8E93' };
  const headingStyle: React.CSSProperties = { fontSize: 15, fontWeight: 600, marginBottom: 20, color: '#1D1D1F' };
  const selectedMembers = users.filter((user) => selectedMemberIds.includes(user.id));
  const siblingParentId = selectedDept ? selectedDept.parentId : null;
  const memberColumns = [
    { title: '用户名', dataIndex: 'username' },
    { title: '邮箱', dataIndex: 'email', render: (value: string | null) => value || '-' },
    { title: '原部门字段', dataIndex: 'department', render: (value: string | null) => value || '-' },
    { title: '角色', dataIndex: 'roleName', render: (value: string | null) => value || '-' },
    { title: '状态', dataIndex: 'isActive', render: (value: boolean) => value ? <Tag color="green">启用</Tag> : <Tag>禁用</Tag> },
    { title: '最后登录', dataIndex: 'lastLogin', render: (value: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '-' },
  ];

  return (
    <Card style={cardStyle}>
      <div style={headingStyle}><ApartmentOutlined style={{ marginRight: 8, color: '#007AFF' }} />组织管理</div>
      <Spin spinning={loading}>
        <div className="organization-layout" style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) 1fr', gap: 24, alignItems: 'start' }}>
          <div style={{ border: '0.5px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: 12, minHeight: 320 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>部门树</span>
              <Space size={4}>
                {can('organization', 'create') && selectedDept && (
                  <Tooltip title="新增同级部门">
                    <Button
                      type="text"
                      size="small"
                      icon={<PlusOutlined />}
                      loading={saving}
                      onClick={() => handleCreateDepartment(siblingParentId, '同级部门已创建')}
                      aria-label="新增同级部门"
                    />
                  </Tooltip>
                )}
                {selectedDeptId && (
                  <Tooltip title="清除选择">
                    <Button
                      type="text"
                      size="small"
                      icon={<CloseOutlined />}
                      onClick={() => setSelectedDeptId(null)}
                      aria-label="清除选择"
                    />
                  </Tooltip>
                )}
              </Space>
            </div>
            {departments.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无部门"
              >
                {can('organization', 'create') && (
                  <Tooltip title="创建第一个部门">
                    <Button
                      type="primary"
                      shape="circle"
                      icon={<PlusOutlined />}
                      loading={saving}
                      onClick={() => handleCreateDepartment(null)}
                      aria-label="创建第一个部门"
                    />
                  </Tooltip>
                )}
              </Empty>
            ) : (
              <Tree
                selectedKeys={selectedDeptId ? [selectedDeptId] : []}
                defaultExpandAll
                treeData={toTreeData(departments)}
                onSelect={handleSelectDepartment}
              />
            )}
          </div>

          <div>
            {selectedDept ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: '#1D1D1F' }}>{selectedDept.name}</div>
                    <div style={hintStyle}>编辑部门信息、归属员工和上下级关系</div>
                  </div>
                  {can('organization', 'create') && (
                    <Button
                      icon={<PlusOutlined />}
                      onClick={() => handleCreateDepartment(selectedDept.id)}
                      loading={saving}
                    >
                      新增子部门
                    </Button>
                  )}
                </div>
                <div className="responsive-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 14, marginBottom: 8 }}><span style={{ color: '#FF3B30' }}>* </span>部门名称</div>
                    <Input disabled={!canManage} value={deptDraft.name} onChange={(e) => setDeptDraft((draft) => ({ ...draft, name: e.target.value }))} placeholder="例如：安全合规部" />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, marginBottom: 8 }}>上级部门</div>
                    <Select
                      allowClear
                      disabled={!canManage}
                      value={deptDraft.parentId || undefined}
                      onChange={(value) => setDeptDraft((draft) => ({ ...draft, parentId: value || '' }))}
                      placeholder="无上级部门"
                      style={{ width: '100%' }}
                      options={flattenDepartments(departments).filter((item) => item.id !== selectedDeptId).map((item) => ({ value: item.id, label: item.name }))}
                    />
                  </div>
                </div>
                <div className="responsive-form-grid responsive-form-grid-narrow" style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 16, marginTop: 16 }}>
                  <div>
                    <div style={{ fontSize: 14, marginBottom: 8 }}>说明</div>
                    <Input disabled={!canManage} value={deptDraft.description} onChange={(e) => setDeptDraft((draft) => ({ ...draft, description: e.target.value }))} placeholder="部门职责或权限边界" />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, marginBottom: 8 }}>排序</div>
                    <InputNumber disabled={!canManage} min={0} value={deptDraft.sortOrder} onChange={(value) => setDeptDraft((draft) => ({ ...draft, sortOrder: value || 0 }))} style={{ width: '100%' }} />
                  </div>
                </div>

                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>部门员工</div>
                  <Select
                    mode="multiple"
                    disabled={!canManage}
                    value={selectedMemberIds}
                    onChange={setSelectedMemberIds}
                    placeholder="选择可归属到该部门的员工"
                    style={{ width: '100%' }}
                    optionFilterProp="label"
                    options={users.map((user) => ({
                      value: user.id,
                      label: `${user.username}${user.email ? ` · ${user.email}` : ''}`,
                    }))}
                  />
                </div>

                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>部门员工账户</div>
                  <Table
                    rowKey="id"
                    size="small"
                    columns={memberColumns}
                    dataSource={selectedMembers}
                    pagination={false}
                    locale={{ emptyText: '该部门暂无员工' }}
                  />
                </div>

                {canManage && (
                  <Space style={{ marginTop: 20 }}>
                    {can('organization', 'update') && (
                      <Button type="primary" onClick={handleSaveDepartment} loading={saving} style={btnStyle}>保存组织权限</Button>
                    )}
                    {can('organization', 'delete') && (
                      <Popconfirm
                        title="删除该部门？"
                        description="仅空部门可以删除。"
                        okText="确认"
                        cancelText="取消"
                        onConfirm={handleDeleteDepartment}
                      >
                        <Button danger icon={<DeleteOutlined />} loading={saving}>删除部门</Button>
                      </Popconfirm>
                    )}
                  </Space>
                )}
              </>
            ) : (
              <Empty description="请选择或新增一个部门" />
            )}
          </div>
        </div>
      </Spin>
    </Card>
  );
}
