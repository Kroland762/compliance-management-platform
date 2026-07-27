import { useState, useEffect } from 'react';
import { Table, Tag, Button, Space, message, Modal, Form, Input, Select, Tooltip } from 'antd';
import { EyeOutlined, AuditOutlined, SettingOutlined, PlusOutlined, DeleteOutlined, MailOutlined, UserSwitchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../utils/error';
import { TASK_STATUS } from '../../constants/status';


const statusMap = TASK_STATUS;

export default function ReviewTaskList() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [auditors, setAuditors] = useState<any[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'administrator';

  const fetchTasks = () => {
    setLoading(true);
    apiClient.get('/tasks').then((res: any) => {
      setTasks(res.data?.items || []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchTasks(); }, []);

  
  const handleRemind = async (id: string) => {
    try {
      await apiClient.post(`/tasks/${id}/remind`);
      message.success('催办邮件已发送');
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '发送失败'));
    }
  };

const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/tasks/${id}`);
      message.success('任务已删除');
      fetchTasks();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '删除失败'));
    }
  };

  const openCreate = () => {
    apiClient.get('/templates').then((res: any) => setTemplates(res.data?.items || []));
    apiClient.get('/users?role=administrator&role=auditor').then((res: any) => setAuditors(res.data?.items || []));
    setCreateVisible(true);
  };

  const handleCreate = async (values: any) => {
    setCreateLoading(true);
    try {
      await apiClient.post('/tasks', values);
      message.success('审计任务已创建');
      setCreateVisible(false);
      form.resetFields();
      fetchTasks();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '创建失败'));
    } finally { setCreateLoading(false); }
  };

  const columns = [
    { title: '评估方式', dataIndex: 'assessmentType', width: 120 },
    { title: '评估对象', dataIndex: 'assessmentTarget', width: 160 },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: string) => {
        const s = statusMap[v] || { color: 'default', text: v };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    {
      title: '审计员', width: 100,
      render: (_: any, record: any) => {
        const rid = record.reviewerId;
        // Show username from reviewer if available, otherwise creator
        if (record.reviewer?.username) return record.reviewer.username;
        if (rid === record.createdBy) return record.creator?.username || '-';
        return rid ? rid.substring(0,8) : '-';
      },
    },
    {
      title: '创建人', width: 100,
      render: (_: any, record: any) => record.creator?.username || '-',
    },
    {
      title: '普通用户', width: 120,
      render: (_: any, record: any) => {
        const assignees = record._assignees || [];
        if (assignees.length === 0) return '-';
        return assignees.join('、');
      },
    },
    {
      title: '完成率', width: 90,
      render: (_: any, record: any) => {
        const s = record._stats;
        if (!s || !s.total) return <span style={{ color: '#AEAEB2' }}>-</span>;
        const pct = Math.round((s.answered / s.total) * 100);
        const color = pct === 100 ? '#34C759' : pct > 0 ? '#FF9500' : '#8E8E93';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: '#E8E8ED' }}>
              <div style={{ width: `${pct}%`, height: 4, borderRadius: 2, background: color }} />
            </div>
            <span style={{ fontSize: 12, color }}>{pct}%</span>
          </div>
        );
      },
    },
    {
      title: '创建时间', dataIndex: 'createdAt', width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '提交时间', dataIndex: 'submittedAt', width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作', width: 150, fixed: 'right' as const,
      render: (_: any, record: any) => {
        const canConfigure = record.status === 'draft' || record.status === 'assigned';
        const canReview = record.status === 'submitted' || record.status === 'under_review';
        return (
          <Space size={4}>
            {canConfigure && (
              <Button size="small" type="primary" icon={<SettingOutlined />}
                onClick={() => navigate(`/tasks/configure/${record.id}`)}>
                配置
              </Button>
            )}
            {canReview && (
              <Button size="small" type="primary" icon={<AuditOutlined />}
                onClick={() => navigate(`/tasks/review/${record.id}`)}>
                审阅
              </Button>
            )}
            {!canConfigure && !canReview && (
              <Button size="small" icon={<EyeOutlined />}
                onClick={() => navigate(`/tasks/review/${record.id}`)}>
                查看
              </Button>
            )}
            {isAdmin && (
              <>
                <Tooltip title="发送催办邮件">
                  <Button size="small" icon={<MailOutlined />} onClick={() => handleRemind(record.id)}
                    disabled={!record.assignee?.username || record.status === 'draft'} />
                </Tooltip>
                {confirmingDelete === record.id ? (
                  <Space size={4}>
                    <Button size="small" type="primary" danger onClick={() => { handleDelete(record.id); setConfirmingDelete(null); }}>确认</Button>
                    <Button size="small" onClick={() => setConfirmingDelete(null)}>取消</Button>
                  </Space>
                ) : (
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => setConfirmingDelete(record.id)} />
                )}
              </>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        {isAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}
            style={{ borderRadius: 10, fontWeight: 500 }}>
            创建任务
          </Button>
        )}
      </div>
      <div style={{
        background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 18, padding: '20px 24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 0.5px rgba(0,0,0,0.04)',
      }}>
        <Table columns={columns} dataSource={tasks} rowKey="id" loading={loading}
          scroll={{ x: 1100 }} size="small" />
      </div>

      <Modal title="创建审计任务" open={createVisible} onCancel={() => { setCreateVisible(false); form.resetFields(); }}
        footer={null} width={480}>
        <Form form={form} layout="vertical" onFinish={handleCreate} style={{ marginTop: 16 }}>
          <Form.Item name="assessmentType" label="评估方式" rules={[{ required: true, message: '请输入评估方式' }]}>
            <Input placeholder="例如：ISO 27001、网络安全等级保护" size="large" />
          </Form.Item>
          <Form.Item name="assessmentTarget" label="评估对象" rules={[{ required: true, message: '请输入评估对象' }]}>
            <Input placeholder="例如：核心业务系统" size="large" />
          </Form.Item>
          <Form.Item name="reviewerId" label="审计员" rules={[{ required: true, message: '请选择审计员' }]}>
            <Select placeholder="选择负责此任务的审计员" size="large"
              options={auditors.map((u: any) => ({ value: u.id, label: u.username + (u.department ? '（' + u.department + '）' : '') }))} />
          </Form.Item>
          <Form.Item name="templateId" label="合规模板" rules={[{ required: true, message: '请选择合规模板' }]}>
            <Select placeholder="选择审计问卷" size="large"
              options={templates.map((t: any) => ({ value: t.id, label: `${t.name}（${t.questionCount}题）` }))} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createLoading} block size="large"
            style={{ borderRadius: 12, fontWeight: 500 }}>
            创建
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
