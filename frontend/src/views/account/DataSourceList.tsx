import { useState, useEffect } from 'react';
import { Table, Button, Input, Space, Tag, Typography, message, Popconfirm, Tooltip, Switch } from 'antd';
import { PlusOutlined, SyncOutlined, DeleteOutlined, EyeOutlined, LinkOutlined, SearchOutlined, ExclamationCircleOutlined, EditOutlined, UploadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { dataSourceApi, type DataSource } from '../../api/account';
import { getApiErrorMessage } from '../../utils/error';
import { useAuthStore } from '../../store/auth';
import CsvReuploadModal from './CsvReuploadModal';

const { Text } = Typography;

const statusColors: Record<string, string> = { ACTIVE: 'green', INACTIVE: 'default' };
const statusLabels: Record<string, string> = { ACTIVE: '正常', INACTIVE: '停用' };
const mappingColors: Record<string, string> = { CONFIGURED: 'green', UNCONFIGURED: 'default' };
const mappingLabels: Record<string, string> = { CONFIGURED: '已配置', UNCONFIGURED: '未配置' };

export default function DataSourceList() {
  const navigate = useNavigate();
  const can = useAuthStore((state) => state.hasPermission);
  const [data, setData] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [syncing, setSyncing] = useState<string | null>(null);
  const [togglingDs, setTogglingDs] = useState<string | null>(null);
  const [connectionMap, setConnectionMap] = useState<Record<string, 'ok' | 'fail' | 'testing'>>({});
  const [uploadingSource, setUploadingSource] = useState<DataSource | null>(null);

  const fetchData = () => {
    setLoading(true);
    const params: any = {};
    if (keyword) params.search = keyword;
    dataSourceApi.list(params)
      .then((res: any) => {
        const items = res.data?.items || [];
        setData(items);
      })
      .catch(() => message.error('获取数据源列表失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

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
      render: (value: string) => (
        <Tag color={value === 'CSV' ? 'cyan' : 'blue'} style={{ borderRadius: 6 }}>
          {value === 'CSV' ? 'CSV' : 'PostgreSQL'}
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
        return can('data_sources', 'update')
          ? <a onClick={() => handleTestConnection(record.id)} style={{ cursor: 'pointer', color: '#007AFF', fontSize: 13 }}>点击检测</a>
          : <Text type="secondary">未检测</Text>;
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
        can('data_sources', 'update') ? <Switch
          size="small"
          checked={v === 'ACTIVE'}
          loading={togglingDs === record.id}
          onChange={() => handleToggle(record.id)}
        /> : <Tag color={v === 'ACTIVE' ? 'green' : 'default'}>{v === 'ACTIVE' ? '启用' : '停用'}</Tag>
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
          {can('data_sources', 'update') && <Tooltip title="编辑">
            <Button size="small" icon={<EditOutlined />}
              onClick={() => navigate(`/account-audit/data-sources/${record.id}/edit`)} />
          </Tooltip>}
          {record.sourceType === 'DATABASE' && can('data_sources', 'sync') && <Tooltip title="同步">
            <Button size="small" icon={<SyncOutlined spin={syncing === record.id} />}
              loading={syncing === record.id} onClick={() => handleSync(record.id)} />
          </Tooltip>}
          {record.sourceType === 'DATABASE' && can('data_sources', 'sync') && <Tooltip title="强制同步">
            <Button size="small" onClick={() => handleSync(record.id, true)}
              loading={syncing === record.id}>强制</Button>
          </Tooltip>}
          {record.sourceType === 'DATABASE' && can('data_sources', 'update') && <Tooltip title="测试连接">
            <Button size="small" icon={<LinkOutlined />}
              loading={connectionMap[record.id] === 'testing'}
              onClick={() => handleTestConnection(record.id)} />
          </Tooltip>}
          {record.sourceType === 'CSV' && can('data_sources', 'sync') && <Tooltip title="重新上传 CSV">
            <Button size="small" icon={<UploadOutlined />} onClick={() => setUploadingSource(record)} />
          </Tooltip>}
          {can('data_sources', 'delete') && <Popconfirm title="确定删除？" icon={<ExclamationCircleOutlined style={{ color: '#FF3B30' }} />}
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
            placeholder="搜索名称"
            prefix={<SearchOutlined style={{ color: '#AEAEB2' }} />}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 240 }}
            allowClear
          />
          <Button onClick={handleSearch}>查询</Button>
          {can('data_sources', 'create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/account-audit/data-sources/new')}>
              添加数据源
            </Button>
          )}
        </div>
      </div>

      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} scroll={{ x: 1100 }} size="small" />

      <CsvReuploadModal
        open={Boolean(uploadingSource)}
        source={uploadingSource}
        onClose={() => setUploadingSource(null)}
        onSuccess={fetchData}
      />

    </div>
  );
}
