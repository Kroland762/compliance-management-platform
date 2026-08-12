import { useState, useEffect } from 'react';
import { Table, Tag, Button, Space, message } from 'antd';
import { EyeOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../utils/error';
import { TASK_STATUS } from '../../constants/status';


const statusMap = TASK_STATUS;

export default function ReviewTaskList() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = Boolean(user?.permissions?.tasks?.includes('create'));
  const canDelete = Boolean(user?.permissions?.tasks?.includes('delete'));

  const fetchTasks = () => {
    setLoading(true);
    apiClient.get('/tasks').then((res: any) => {
      setTasks(res.data?.items || []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchTasks(); }, []);

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/tasks/${id}`);
      message.success('任务已删除');
      fetchTasks();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '删除失败'));
    }
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
        const names = (record.auditors || []).map((item: any) => item.auditor?.username).filter(Boolean);
        return names.length ? names.join('、') : '-';
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
        return (
          <Space size={4}>
            <Button size="small" type="primary" icon={<EyeOutlined />}
              disabled={!record.publishedAt}
              onClick={() => navigate(`/assessments/${record.id}`)}>
              {record.publishedAt ? '查看项目' : '查看配置'}
            </Button>
            {canDelete && (
              <>
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
        <div>
          <h2 style={{ margin: 0 }}>评估项目</h2>
          <span style={{ color: '#8E8E93' }}>按项目跟踪范围、执行、复核和处置闭环</span>
        </div>
        {isAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/assessments/new')}
            style={{ borderRadius: 10, fontWeight: 500 }}>
            新建评估项目
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
    </div>
  );
}
