import { useState, useEffect } from 'react';
import { Table, Button, Tag, Typography, Space, message, Popconfirm, Select, Input } from 'antd';
import { PlusOutlined, PlayCircleOutlined, EditOutlined, DeleteOutlined, HistoryOutlined, ExclamationCircleOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { taskApi, type Task } from '../../api/account';
import { getApiErrorMessage } from '../../utils/error';
import TaskForm from './TaskForm';
import { useAuthStore } from '../../store/auth';

const { Text } = Typography;

const statusColors: Record<string, string> = { ACTIVE: 'green', INACTIVE: 'default' };
const statusLabels: Record<string, string> = { ACTIVE: '启用', INACTIVE: '停用' };
const scheduleLabels: Record<string, string> = { MANUAL: '手动', DAILY: '每日', WEEKLY: '每周', MONTHLY: '每月', CRON: 'Cron' };

export default function TaskList() {
  const can = useAuthStore((state) => state.hasPermission);
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  const [executing, setExecuting] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);

  const fetchTasks = () => {
    setLoading(true);
    const params: any = {};
    if (statusFilter) params.status = statusFilter;
    if (keyword) params.search = keyword;
    taskApi.list(params)
      .then((res: any) => setTasks(res.data?.items || []))
      .catch(() => message.error('获取任务列表失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchTasks(); }, [statusFilter]);

  const handleSearch = () => fetchTasks();

  const handleExecute = async (id: string) => {
    setExecuting(id);
    try {
      await taskApi.execute(id);
      message.success('任务执行请求已提交');
      fetchTasks();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '执行失败'));
    } finally {
      setExecuting(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await taskApi.delete(id);
      message.success('任务已删除');
      fetchTasks();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '删除失败'));
    }
  };

  const columns = [
    {
      title: '任务名称', dataIndex: 'name', width: 160,
      render: (v: string, record: Task) => (
        <a onClick={() => navigate(`/account-audit/tasks/${record.id}/history`)} style={{ fontWeight: 500 }}>{v}</a>
      ),
    },
    { title: '数据源', dataIndex: 'sourceName', width: 130 },
    { title: '规则数', width: 70, align: 'center' as const,
      render: (_: any, record: any) => record.selectedRules?.length || 0 },
    {
      title: '调度', dataIndex: 'scheduleType', width: 80,
      render: (v: string) => <Tag style={{ borderRadius: 6 }}>{scheduleLabels[v] || v}</Tag>,
    },
    {
      title: '状态', dataIndex: 'status', width: 85,
      render: (v: string) => <Tag color={statusColors[v]}>{statusLabels[v] || v}</Tag>,
    },
    {
      title: '上次执行', dataIndex: 'lastExecTime', width: 150,
      render: (v: string | null) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    { title: '发现问题', dataIndex: 'problemsFound', width: 80, align: 'right' as const,
      render: (v: number) => v > 0 ? <Text style={{ color: '#FF3B30', fontWeight: 500 }}>{v}</Text> : <Text type="secondary">0</Text>,
    },
    {
      title: '操作', width: 180, fixed: 'right' as const,
      render: (_: any, record: Task) => (
        <Space size="small">
          {can('account_tasks', 'execute') && <Button size="small" icon={<PlayCircleOutlined />} loading={executing === record.id}
            onClick={() => handleExecute(record.id)}>
            执行
          </Button>}
          {can('account_tasks', 'update') && <Button size="small" icon={<EditOutlined />}
            onClick={() => { setEditingTask(record); setFormOpen(true); }} />}
          <Button size="small" icon={<HistoryOutlined />}
            onClick={() => navigate(`/account-audit/tasks/${record.id}/history`)} />
          {can('account_tasks', 'delete') && <Popconfirm title="确定删除？" icon={<ExclamationCircleOutlined style={{ color: '#FF3B30' }} />}
            onConfirm={() => handleDelete(record.id)} cancelText="取消" okText="确认">
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="filter-toolbar">
        <div className="filter-toolbar-content">
          <Input
            placeholder="搜索任务名称"
            prefix={<SearchOutlined style={{ color: '#AEAEB2' }} />}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 220 }}
            allowClear
          />
          <Select
            placeholder="状态"
            value={statusFilter || undefined}
            onChange={v => setStatusFilter(v || '')}
            allowClear
            style={{ width: 110 }}
            options={[
              { value: 'ACTIVE', label: '启用' },
              { value: 'INACTIVE', label: '停用' },
            ]}
          />
          <Button onClick={handleSearch}>查询</Button>
          {can('account_tasks', 'create') && <Button type="primary" icon={<PlusOutlined />}
            onClick={() => { setEditingTask(null); setFormOpen(true); }}>
            创建任务
          </Button>}
        </div>
      </div>

      <Table columns={columns} dataSource={tasks} rowKey="id" loading={loading} scroll={{ x: 1050 }} size="small" />

      <TaskForm
        open={formOpen}
        editingTask={editingTask}
        onClose={() => { setFormOpen(false); setEditingTask(null); }}
        onSuccess={() => { setFormOpen(false); setEditingTask(null); fetchTasks(); }}
      />
    </div>
  );
}
