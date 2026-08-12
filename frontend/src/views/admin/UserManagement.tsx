import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { EditOutlined, LinkOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../utils/error';
import { useAuthStore } from '../../store/auth';
import { buildDepartmentAssignments, resolvePrimaryDepartmentId } from '../../utils/membership';

const { Text, Paragraph } = Typography;

const memberStatusPresentation: Record<string, { label: string; color: string }> = {
  active: { label: '有效', color: 'green' },
  suspended: { label: '已停用', color: 'orange' },
  left: { label: '已离职', color: 'default' },
  invited: { label: '待接受邀请', color: 'gold' },
};

interface RoleOption {
  id: string;
  name: string;
}

interface DepartmentOption {
  id: string;
  name: string;
  code: string;
  children?: DepartmentOption[];
}

function flatten(items: DepartmentOption[], prefix = ''): Array<{ value: string; label: string }> {
  return items.flatMap((item) => {
    const label = `${prefix}${item.name}`;
    return [{ value: item.id, label }, ...flatten(item.children || [], `${prefix}— `)];
  });
}

export default function UserManagement() {
  const { message } = App.useApp();
  const canCreate = useAuthStore((state) => state.hasPermission('users', 'create'));
  const canUpdate = useAuthStore((state) => state.hasPermission('users', 'update'));
  const canOrganization = useAuthStore((state) => state.hasPermission('organization', 'update'));
  const selectedTenant = useAuthStore((state) => state.selectedTenant);
  const [members, setMembers] = useState<any[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitationLink, setInvitationLink] = useState('');
  const [form] = Form.useForm();
  const [inviteForm] = Form.useForm();
  const selectedDepartmentIds: string[] = Form.useWatch('departmentIds', form) || [];
  const invitedDepartmentIds: string[] = Form.useWatch('departmentIds', inviteForm) || [];

  const loadOptions = async () => {
    const [roleResponse, departmentResponse]: any[] = await Promise.all([
      apiClient.get('/roles?page=1&pageSize=100'),
      apiClient.get('/departments'),
    ]);
    setRoles(roleResponse.data?.items || []);
    setDepartmentOptions(flatten(departmentResponse.data || []));
  };

  const loadMembers = async () => {
    setLoading(true);
    try {
      const [response, invitationResponse]: any[] = await Promise.all([
        apiClient.get('/members', {
          params: { page: 1, pageSize: 100, keyword: keyword || undefined },
        }),
        apiClient.get('/members/invitations'),
      ]);
      const invitations = (invitationResponse.data?.items || [])
        .filter((invitation: any) => !keyword || invitation.targetUsername?.includes(keyword))
        .map((invitation: any) => ({
          id: `invitation-${invitation.id}`,
          username: invitation.targetUsername,
          displayName: '待接受邀请',
          email: invitation.targetEmail,
          status: 'invited',
          invitationStatus: `有效至 ${new Date(invitation.expiresAt).toLocaleString('zh-CN')}`,
          roleIds: invitation.roleIds,
          departments: invitation.departments,
        }));
      setMembers([...(response.data?.items || []), ...invitations]);
    } catch (error) {
      message.error(getApiErrorMessage(error, '成员列表加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOptions().catch((error) => message.error(getApiErrorMessage(error, '角色或部门加载失败')));
  }, []);
  useEffect(() => { loadMembers(); }, [keyword]);
  useEffect(() => {
    const currentPrimary = form.getFieldValue('primaryDepartmentId');
    const nextPrimary = resolvePrimaryDepartmentId(selectedDepartmentIds, currentPrimary);
    if (nextPrimary !== currentPrimary) form.setFieldValue('primaryDepartmentId', nextPrimary);
  }, [form, selectedDepartmentIds]);
  useEffect(() => {
    const currentPrimary = inviteForm.getFieldValue('primaryDepartmentId');
    const nextPrimary = resolvePrimaryDepartmentId(invitedDepartmentIds, currentPrimary);
    if (nextPrimary !== currentPrimary) inviteForm.setFieldValue('primaryDepartmentId', nextPrimary);
  }, [inviteForm, invitedDepartmentIds]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'active', roleIds: [], departmentIds: [] });
    setModalOpen(true);
  };

  const openEdit = (member: any) => {
    setEditing(member);
    const primary = member.departments?.find((item: any) => item.isPrimary);
    form.setFieldsValue({
      displayName: member.displayName,
      email: member.email,
      employeeNo: member.employeeNo,
      status: member.status,
      roleIds: member.roles?.map((item: any) => item.id) || [],
      departmentIds: member.departments?.map((item: any) => item.id) || [],
      primaryDepartmentId: primary?.id,
    });
    setModalOpen(true);
  };

  const save = async (values: any) => {
    try {
      const departments = buildDepartmentAssignments(values.departmentIds, values.primaryDepartmentId);
      if (!editing) {
        const response: any = await apiClient.post('/members', {
          username: values.username,
          displayName: values.displayName,
          email: values.email || null,
          employeeNo: values.employeeNo || null,
          roleIds: values.roleIds,
          departments,
        });
        setTemporaryPassword(response.data.temporaryPassword);
      } else {
        await apiClient.put(`/members/${editing.id}`, {
          displayName: values.displayName,
          email: values.email || null,
          employeeNo: values.employeeNo || null,
          status: values.status,
        });
        await apiClient.put(`/members/${editing.id}/roles`, { roleIds: values.roleIds });
        if (canOrganization) {
          await apiClient.put(`/members/${editing.id}/departments`, { departments });
        }
        message.success('成员资料已更新');
      }
      setModalOpen(false);
      await loadMembers();
    } catch (error) {
      message.error(getApiErrorMessage(error, editing ? '更新失败' : '创建失败'));
    }
  };

  const createInvitation = async (values: any) => {
    try {
      const departments = buildDepartmentAssignments(values.departmentIds, values.primaryDepartmentId);
      const response: any = await apiClient.post('/members/invitations', {
        targetUsername: values.targetUsername,
        roleIds: values.roleIds,
        departments,
      });
      const token = response.data.token;
      const tenantId = selectedTenant?.id || '';
      setInvitationLink(`${window.location.origin}/accept-invitation?tenantId=${encodeURIComponent(tenantId)}&token=${encodeURIComponent(token)}`);
      setInviteOpen(false);
      inviteForm.resetFields();
    } catch (error) {
      message.error(getApiErrorMessage(error, '邀请创建失败'));
    }
  };

  const columns = [
    { title: '用户名', dataIndex: 'username' },
    { title: '姓名', dataIndex: 'displayName' },
    {
      title: '部门',
      render: (_: unknown, member: any) => (
        <Space wrap size={4}>
          {(member.departments || []).map((department: any) => (
            <Tag key={department.id || department.departmentId} color={department.isPrimary ? 'blue' : 'default'}>
              {department.name
                || departmentOptions.find((item) => item.value === department.departmentId)?.label
                || department.departmentId}
              {department.isPrimary ? ' · 主' : ' · 兼职'}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '角色',
      render: (_: unknown, member: any) => (
        <Space wrap size={4}>
          {(member.roles || []).map((role: any) => <Tag key={role.id}>{role.name}</Tag>)}
          {(member.roleIds || []).map((roleId: string) => (
            <Tag key={roleId}>{roles.find((role) => role.id === roleId)?.name || roleId}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (status: string) => {
        const presentation = memberStatusPresentation[status] || { label: status, color: 'default' };
        return <Tag color={presentation.color}>{presentation.label}</Tag>;
      },
    },
    {
      title: '邀请状态',
      render: (_: unknown, member: any) => (
        <Text type={member.status === 'invited' ? 'warning' : 'secondary'}>
          {member.invitationStatus || '已加入'}
        </Text>
      ),
    },
    {
      title: '最后登录',
      dataIndex: 'lastLogin',
      render: (value: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '-',
    },
    ...(canUpdate ? [{
      title: '操作',
      render: (_: unknown, member: any) => (
        member.status === 'invited'
          ? <Text type="secondary">等待接受</Text>
          : <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(member)}>编辑</Button>
      ),
    }] : []),
  ];

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索成员姓名"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          style={{ width: 260 }}
        />
        {canCreate && (
          <Space>
            <Button icon={<LinkOutlined />} onClick={() => setInviteOpen(true)}>邀请已有身份</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建本地成员</Button>
          </Space>
        )}
      </Space>
      <Table rowKey="id" size="small" columns={columns} dataSource={members} loading={loading} />

      <Modal
        title={editing ? `编辑成员 · ${editing.username}` : '新建本地成员'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        okText={editing ? '保存' : '创建'}
        cancelText="取消"
        width={640}
      >
        <Form form={form} layout="vertical" onFinish={save}>
          {!editing && (
            <Form.Item name="username" label="登录用户名" rules={[{ required: true }, { min: 3 }]}>
              <Input autoComplete="off" />
            </Form.Item>
          )}
          <Space align="start" style={{ width: '100%' }} size={16}>
            <Form.Item name="displayName" label="姓名" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="employeeNo" label="工号" style={{ flex: 1 }}><Input /></Form.Item>
          </Space>
          <Form.Item name="email" label="邮箱"><Input /></Form.Item>
          {editing && (
            <Form.Item name="status" label="成员状态" rules={[{ required: true }]}>
              <Select options={[
                { value: 'active', label: '有效' },
                { value: 'suspended', label: '停用' },
                { value: 'left', label: '离职' },
              ]} />
            </Form.Item>
          )}
          <Form.Item name="roleIds" label="多角色" rules={[{ required: true, type: 'array', min: 1 }]}>
            <Select mode="multiple" options={roles.map((role) => ({ value: role.id, label: role.name }))} />
          </Form.Item>
          <Form.Item name="departmentIds" label="所属部门（可多选）" rules={[{ required: true, type: 'array', min: 1 }]}>
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              placeholder="按部门名称搜索"
              options={departmentOptions}
              disabled={editing && !canOrganization}
            />
          </Form.Item>
          <Form.Item name="primaryDepartmentId" label="主部门" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={selectedDepartmentIds.length ? '选择一个主部门' : '请先选择所属部门'}
              options={departmentOptions.filter((item) => selectedDepartmentIds.includes(item.value))}
              disabled={selectedDepartmentIds.length === 0 || (editing && !canOrganization)}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="邀请已有登录身份加入租户"
        open={inviteOpen}
        onCancel={() => setInviteOpen(false)}
        onOk={() => inviteForm.submit()}
        okText="生成邀请链接"
        cancelText="取消"
      >
        <Form form={inviteForm} layout="vertical" onFinish={createInvitation}>
          <Form.Item name="targetUsername" label="已有用户名" rules={[{ required: true }]}>
            <Input placeholder="输入对方现有登录用户名" />
          </Form.Item>
          <Form.Item name="roleIds" label="租户角色" rules={[{ required: true, type: 'array', min: 1 }]}>
            <Select mode="multiple" options={roles.map((role) => ({ value: role.id, label: role.name }))} />
          </Form.Item>
          <Form.Item name="departmentIds" label="所属部门（可多选）" rules={[{ required: true, type: 'array', min: 1 }]}>
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              placeholder="按部门名称搜索"
              options={departmentOptions}
            />
          </Form.Item>
          <Form.Item name="primaryDepartmentId" label="主部门" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={invitedDepartmentIds.length ? '选择一个主部门' : '请先选择所属部门'}
              options={departmentOptions.filter((item) => invitedDepartmentIds.includes(item.value))}
              disabled={invitedDepartmentIds.length === 0}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="一次性临时密码"
        open={Boolean(temporaryPassword)}
        closable={false}
        maskClosable={false}
        okText="我已安全保存"
        cancelButtonProps={{ style: { display: 'none' } }}
        onOk={() => setTemporaryPassword('')}
      >
        <Paragraph type="warning">关闭后无法再次查看。成员首次登录必须修改密码。</Paragraph>
        <Input.TextArea value={temporaryPassword} readOnly autoSize />
      </Modal>
      <Modal
        title="一次性邀请链接"
        open={Boolean(invitationLink)}
        closable={false}
        maskClosable={false}
        okText="我已安全发送"
        cancelButtonProps={{ style: { display: 'none' } }}
        onOk={() => setInvitationLink('')}
      >
        <Paragraph type="warning">链接只显示一次、72 小时内有效且接受后不可重放。</Paragraph>
        <Input.TextArea value={invitationLink} readOnly autoSize />
      </Modal>
    </div>
  );
}
