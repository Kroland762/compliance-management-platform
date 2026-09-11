import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Typography, Button, Table, Tag, Progress, Space, message, Descriptions, Card } from 'antd';
import { ArrowLeftOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { taskApi, type TaskExecution, type Task } from '../../api/account';
import { getApiErrorMessage } from '../../utils/error';
import { useAuthStore } from '../../store/auth';

const { Title, Text } = Typography;

const statusColors: Record<string, string> = {
  ACTIVE: 'green', INACTIVE: 'default', RUNNING: 'processing', SUCCESS: 'green', FAILED: 'red',
};
const statusLabels: Record<string, string> = {
  ACTIVE: '启用', INACTIVE: '停用', RUNNING: '运行中', SUCCESS: '成功', FAILED: '失败',
};
const phaseColors: Record<string, string> = {
  pending: 'default', running: 'blue', completed: 'green', failed: 'red',
};

export default function TaskHistory() {
  const canExecute = useAuthStore((state) => state.hasPermission('account_tasks', 'execute'));
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = () => {
    if (!id) return;
    setLoading(true);
    Promise.allSettled([
      taskApi.get(id),
      taskApi.executions(id),
    ]).then(([taskRes, execRes]) => {
      if (taskRes.status === 'fulfilled') {
        setTask((taskRes.value as any).data);
      }
      if (execRes.status === 'fulfilled') {
        setExecutions((execRes.value as any).data?.items || []);
      }
    }).catch(() => {
      message.error('获取数据失败');
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [id]);

  const handleExecute = async () => {
    if (!id) return;
    try {
      await taskApi.execute(id);
      message.success('任务执行请求已提交');
      fetchData();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '执行失败'));
    }
  };

  const columns = [
    {
      title: '开始时间', dataIndex: 'startTime', width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '结束时间', dataIndex: 'endTime', width: 160,
      render: (v: string | null) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '状态', dataIndex: 'status', width: 85,
      render: (v: string) => <Tag color={statusColors[v]}>{statusLabels[v] || v}</Tag>,
    },
    {
      title: '阶段', dataIndex: 'currentPhase', width: 100,
      render: (v: string, record: TaskExecution) => (
        <Space size={4}>
          <Tag color={phaseColors[record.status] || 'default'} style={{ borderRadius: 4 }}>{v || '-'}</Tag>
        </Space>
      ),
    },
    {
      title: '进度', dataIndex: 'phaseProgress', width: 140,
      render: (v: number) => <Progress percent={v} size="small" style={{ minWidth: 100 }} />,
    },
    {
      title: '处理账户', dataIndex: 'accountsProcessed', width: 90, align: 'right' as const,
      render: (v: number) => v?.toLocaleString() || '-',
    },
    {
      title: '发现问题', dataIndex: 'problemsFound', width: 90, align: 'right' as const,
      render: (v: number) => v > 0 ? <Text style={{ color: '#FF3B30', fontWeight: 500 }}>{v}</Text> : <Text type="secondary">0</Text>,
    },
    {
      title: '错误信息', dataIndex: 'errorMessage', ellipsis: true, width: 200,
      render: (v: string | null) => v ? <Text type="danger" style={{ fontSize: 12 }}>{v}</Text> : '-',
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/account-audit/tasks')} type="text" />
          <Title level={3} style={{ fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 24 }}>
            {task ? task.name : '加载中...'}
          </Title>
          {task && (
            <Tag color={statusColors[task.status]}>{statusLabels[task.status] || task.status}</Tag>
          )}
        </div>
        {canExecute && <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleExecute}>
          立即执行
        </Button>}
      </div>

      {/* Task Info Summary */}
      {task && (
        <Card
          size="small"
          style={{
            background: 'rgba(255,255,255,0.8)',
            backdropFilter: 'blur(20px)',
            borderRadius: 14,
            border: '0.5px solid rgba(0,0,0,0.06)',
            marginBottom: 20,
          }}
        >
          <Descriptions column={4} size="small">
            <Descriptions.Item label="数据源">{task.sourceName}</Descriptions.Item>
            <Descriptions.Item label="规则数">{task.ruleCount}</Descriptions.Item>
            <Descriptions.Item label="调度">
              <Tag style={{ borderRadius: 4 }}>{task.scheduleType}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="发现总问题数">
              <Text style={{ color: task.problemsFound > 0 ? '#FF3B30' : '#636366', fontWeight: 500 }}>
                {task.problemsFound}
              </Text>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {/* Execution History Table */}
      <div style={{
        background: 'rgba(255,255,255,0.8)',
        backdropFilter: 'blur(20px)',
        borderRadius: 14,
        border: '0.5px solid rgba(0,0,0,0.06)',
        padding: '16px 20px',
      }}>
        <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 12 }}>执行历史</Text>
        <Table
          columns={columns}
          dataSource={executions}
          rowKey="id"
          loading={loading}
          size="small"
          scroll={{ x: 950 }}
          locale={{ emptyText: '暂无执行记录' }}
        />
      </div>
    </div>
  );
}
