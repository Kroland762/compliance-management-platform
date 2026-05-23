import { useState, useEffect } from 'react';
import { Table, Button, Input, Select, Space, Tag, message, Popconfirm, Tooltip, Switch } from 'antd';
import { PlusOutlined, SyncOutlined, DeleteOutlined, EyeOutlined, LinkOutlined, SearchOutlined, ExclamationCircleOutlined, EditOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { dataSourceApi, type DataSource } from '../../api/account';
import { getApiErrorMessage } from '../../utils/error';
import DataSourceForm from './DataSourceForm';

const statusColors: Record<string, string> = { active: 'green', inactive: 'default', error: 'red' };
const statusLabels: Record<string, string> = { active: '正常', inactive: '停用', error: '异常' };
const mappingColors: Record<string, string> = { mapped: 'green', partial: 'orange', unmapped: 'default' };
const mappingLabels: Record<string, string> = { mapped: '已映射', partial: '部分映射', unmapped: '未映射' };

export default function DataSourceList() {
  const navigate = useNavigate();
  const [data, setData] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [syncing, setSyncing] = useState<string | null>(null);
  const [togglingDs, setTogglingDs] = useState<string | null>(null);
  const [editingDs, setEditingDs] = useState<DataSource | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [connectionMap, setConnectionMap] = useState<Record<string, 'ok' | 'fail' | 'testing'>>({});

  const fetchData = () => {
    setLoading(true);
    const params: any = {};
    if (keyword) params.keyword = keyword;
    if (typeFilter) params.type = typeFilter;
    dataSourceApi.list(params)
      .then((res: any) => {
        const items = res.data?.items || [];
        setData(items);
        // Auto-test database connections
        items.filter((ds: DataSource) => ds.sourceType === 'DATABASE').forEach((ds: DataSource) => {
          handleTestConnection(ds.id);
        });
      })
      .catch(() => message.error('获取数据源列表失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [typeFilter]);

  const handleSearch = () => fetchData();

  const handleTestConnection = async (id: string) => {
    setConnectionMap(prev => ({ ...prev, [id]: 'testing' }));
    try {
      const res: any = await dataSourceApi.testConnection(id);
      setConnectionMap(prev => ({ ...prev, [id]: res.data?.success !== false ? 'ok' : 'fail' }));
    } catch {
      setConnectionMap(prev => ({ ...prev, [id]: 'fail' }));
    }
  };

  const handleSync = async (id: string, force = false) => {
    setSyncing(id);
    try {
      const res: any = await dataSourceApi.sync(id, force);
      if (res.data?.skipped) {
        message.info(res.data.reason || '数据无变化，已跳过同步', 5);
      } else {
        const imported = res.data?.imported || 0;
        message.success(imported > 0 ? `同步完成，导入 ${imported} 条` : '同步完成');
      }
      fetchData();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '同步失败'));
    } finally {
      setSyncing(null);
    }
  };

  const handleToggle = async (id: string) => {
    setTogglingDs(id);
    try {
      await dataSourceApi.toggle(id);
      message.success('状态已更新');
      fetchData();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '操作失败'));
    } finally {
      setTogglingDs(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await dataSourceApi.delete(id);
      message.success('数据源已删除');
      fetchData();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '删除失败'));
    }
  };

  const columns = [
    {
      title: '名称', dataIndex: 'name', width: 160,
      render: (v: string, record: DataSource) => (
        <a onClick={() => navigate(`/account-audit/data-sources/${record.id}`)} style={{ fontWeight: 500 }}>{v}</a>
      ),
    },
    {
      title: '类型', dataIndex: 'sourceType', width: 80,
      render: (v: string) => (
        <Tag color={v === 'DATABASE' ? 'blue' : 'purple'} style={{ borderRadius: 6 }}>
          {v === 'DATABASE' ? '数据库' : 'CSV'}
        </Tag>
      ),
    },
    {
      title: '连接', width: 80,
      render: (_: any, record: DataSource) => {
        if (record.sourceType !== 'DATABASE') return <Tag style={{ borderRadius: 6 }}>—</Tag>;
        const s = connectionMap[record.id];
        if (s === 'testing') return <Tag color="processing" style={{ borderRadius: 6 }} icon={<SyncOutlined spin />}>检测中</Tag>;
        if (s === 'ok') return <Tag color="success" style={{ borderRadius: 6 }}>已连接</Tag>;
        if (s === 'fail') return <Tag color="error" style={{ borderRadius: 6 }}>连接失败</Tag>;
        return <a onClick={() => handleTestConnection(record.id)} style={{ cursor: 'pointer', color: '#007AFF', fontSize: 13 }}>点击检测</a>;
      },
    },
    {
      title: '映射状态', dataIndex: 'mappingStatus', width: 90,
      render: (v: string) => <Tag color={mappingColors[v] || 'default'}>{mappingLabels[v] || v}</Tag>,
    },
    { title: '关联任务', dataIndex: 'taskCount', width: 70, align: 'center' as const },
    { title: '账户数', dataIndex: 'totalAccounts', width: 70, align: 'right' as const,
      render: (v: number) => v?.toLocaleString() || '-',
    },
    {
      title: '启用', dataIndex: 'status', width: 60, align: 'center' as const,
      render: (v: string, record: DataSource) => (
        <Switch
          size="small"
          checked={v === 'ACTIVE'}
          loading={togglingDs === record.id}
          onChange={() => handleToggle(record.id)}
        />
      ),
    },
    {
      title: '状态', dataIndex: 'status', width: 60,
      render: (v: string) => (
        <Tag color={statusColors[v] || 'default'}>{statusLabels[v] || v}</Tag>
      ),
    },
    {
      title: '最后同步', dataIndex: 'lastSyncTime', width: 140,
      render: (v: string | null) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作', width: 200, fixed: 'right' as const,
      render: (_: any, record: DataSource) => (
        <Space size="small">
          <Tooltip title="查看详情">
            <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/account-audit/data-sources/${record.id}`)} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button size="small" icon={<EditOutlined />}
              onClick={() => { setEditingDs(record); setFormOpen(true); }} />
          </Tooltip>
          <Tooltip title="同步">
            <Button size="small" icon={<SyncOutlined spin={syncing === record.id} />}
              loading={syncing === record.id} onClick={() => handleSync(record.id)} />
          </Tooltip>
          <Tooltip title="强制同步">
            <Button size="small" onClick={() => handleSync(record.id, true)}
              loading={syncing === record.id}>强制</Button>
          </Tooltip>
          <Tooltip title="测试连接">
            <Button size="small" icon={<LinkOutlined />}
              loading={connectionMap[record.id] === 'testing'}
              onClick={() => handleTestConnection(record.id)} />
          </Tooltip>
          <Popconfirm title="确定删除？" icon={<ExclamationCircleOutlined style={{ color: '#FF3B30' }} />}
            onConfirm={() => handleDelete(record.id)} cancelText="取消" okText="确认">
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input
          placeholder="搜索名称"
          prefix={<SearchOutlined style={{ color: '#AEAEB2' }} />}
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onPressEnter={handleSearch}
          style={{ width: 240 }}
          allowClear
        />
        <Select
          placeholder="类型筛选"
          value={typeFilter || undefined}
          onChange={v => setTypeFilter(v || '')}
          allowClear
          style={{ width: 120 }}
          options={[
            { value: 'DATABASE', label: '数据库' },
            { value: 'CSV', label: 'CSV' },
          ]}
        />
        <Button onClick={handleSearch}>查询</Button>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/account-audit/data-sources/new')}>
          添加数据源
        </Button>
      </div>

      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} scroll={{ x: 1100 }} size="small" />

      <DataSourceForm
        open={formOpen}
        editingDataSource={editingDs}
        onClose={() => { setFormOpen(false); setEditingDs(null); }}
        onSuccess={() => { setFormOpen(false); setEditingDs(null); fetchData(); }}
      />
    </div>
  );
}
