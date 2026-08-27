import { useState, useEffect } from 'react';
import { Alert, Button, Descriptions, Empty, Space, Table, Tag, Tooltip, message } from 'antd';
import { DeleteOutlined, EyeOutlined, PlusOutlined, QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../utils/error';
import { TASK_STATUS } from '../../constants/status';


const statusMap = TASK_STATUS;

export default function ReviewTaskList() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = Boolean(user?.permissions?.tasks?.includes('create'));
  const canDelete = Boolean(user?.permissions?.tasks?.includes('delete'));

  const fetchTasks = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res: any = await apiClient.get('/tasks');
      setTasks(res.data?.items || []);
    } catch (error) {
      setLoadError(getApiErrorMessage(error, '评估项目加载失败'));
    } finally {
      setLoading(false);
    }
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
    { title: '评估方式', dataIndex: 'assessmentType', width: 120, ellipsis: true },
    { title: '评估对象', dataIndex: 'assessmentTarget', width: 180, ellipsis: true },
    {
      title: (
        <Space size={4}>
          项目状态
          <Tooltip title="表示评估项目所处的生命周期阶段，与评估行的填写、提交和复核进度相互独立。">
            <QuestionCircleOutlined aria-label="项目状态说明" />
          </Tooltip>
        </Space>
      ),
      dataIndex: 'status', width: 110,
      render: (v: string) => {
        const s = statusMap[v] || { color: 'default', text: v };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    {
      title: '审计员', width: 140, ellipsis: true,
      render: (_: any, record: any) => {
        const names = (record.auditors || []).map((item: any) => item.auditor?.username).filter(Boolean);
        return names.length ? names.join('、') : '-';
      },
    },
    {
      title: (
        <Space size={4}>
          填写进度
          <Tooltip title="按评估行统计已完成复核的比例，不代表项目生命周期状态。">
            <QuestionCircleOutlined aria-label="填写进度说明" />
          </Tooltip>
        </Space>
      ),
      width: 140,
      render: (_: any, record: any) => {
        const s = record._stats;
        if (!s || !s.total) return <span style={{ color: '#636366' }}>-</span>;
        const pct = Math.round((s.answered / s.total) * 100);
        const progressColor = pct === 100 ? '#34C759' : pct > 0 ? '#FF9500' : '#8E8E93';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: '#E8E8ED' }}>
              <div style={{ width: `${pct}%`, height: 4, borderRadius: 2, background: progressColor }} />
            </div>
            <span style={{ fontSize: 12, color: '#636366' }}>{pct}%</span>
          </div>
        );
      },
    },
    {
      title: '提交时间', dataIndex: 'submittedAt', width: 170,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作', width: 190, fixed: 'right' as const,
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
                  <Button size="small" danger icon={<DeleteOutlined />} aria-label={`删除评估项目 ${record.name || record.assessmentTarget || ''}`} onClick={() => setConfirmingDelete(record.id)} />
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
          <span style={{ color: '#636366' }}>按项目跟踪范围、执行、复核和处置闭环</span>
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
        {loadError && (
          <Alert
            type="error"
            showIcon
            message="评估项目加载失败"
            description={loadError}
            action={<Button size="small" icon={<ReloadOutlined />} onClick={() => void fetchTasks()}>重试</Button>}
            style={{ marginBottom: 16 }}
          />
        )}
        <Table columns={columns} dataSource={tasks} rowKey="id" loading={loading}
          scroll={{ x: 1050 }} size="small"
          locale={{
            emptyText: loadError
              ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂时无法显示评估项目，请重试" />
              : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无评估项目" />,
          }}
          expandable={{
            expandedRowRender: (record) => (
              <Descriptions size="small" column={3} items={[
                { key: 'creator', label: '创建人', children: record.creator?.username || '-' },
                { key: 'assignee', label: '默认责任人', children: record.assignee?.username || record._assignees?.join('、') || '-' },
                { key: 'createdAt', label: '创建时间', children: record.createdAt ? new Date(record.createdAt).toLocaleString('zh-CN') : '-' },
              ]} />
            ),
          }} />
      </div>
    </div>
  );
}
