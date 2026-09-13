import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Typography, Button, Tabs, Table, Tag, Descriptions, Space, message, Spin, Row, Col, Statistic, Card } from 'antd';
import { ArrowLeftOutlined, SyncOutlined, LinkOutlined, EditOutlined, RiseOutlined, FallOutlined, LineChartOutlined, UploadOutlined } from '@ant-design/icons';
import { dataSourceApi, type DataSource, type DataSourceAccount, type AccountChanges } from '../../api/account';
import { getApiErrorMessage } from '../../utils/error';
import { useAuthStore } from '../../store/auth';
import CsvReuploadModal from './CsvReuploadModal';

const { Title, Text } = Typography;

const statusColors: Record<string, string> = { ACTIVE: 'green', INACTIVE: 'default' };
const statusLabels: Record<string, string> = { ACTIVE: '正常', INACTIVE: '停用' };
const dbTypeLabels: Record<string, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mssql: 'SQL Server',
  oracle: 'Oracle',
  sqlite: 'SQLite',
};

function dataSourceTypeLabel(ds: DataSource) {
  if (ds.sourceType === 'CSV') return 'CSV';
  const dbType = String(ds.connectionConfig?.dbType || 'postgres').toLowerCase();
  return dbTypeLabels[dbType] || '数据库';
}

export default function DataSourceDetail() {
  const can = useAuthStore((state) => state.hasPermission);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [ds, setDs] = useState<DataSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<DataSourceAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [changes, setChanges] = useState<AccountChanges | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    dataSourceApi.get(id)
      .then((res: any) => setDs(res.data))
      .catch(() => message.error('获取数据源详情失败'))
      .finally(() => setLoading(false));
  }, [id]);

  const fetchAccounts = () => {
    if (!id) return;
    setAccountsLoading(true);
    dataSourceApi.preview(id)
      .then((res: any) => setAccounts(res.data?.items || []))
      .catch(() => message.error('获取账户数据失败'))
      .finally(() => setAccountsLoading(false));
  };

  const fetchChanges = () => {
    if (!id) return;
    dataSourceApi.accountChanges(id)
      .then((res: any) => setChanges(res.data))
      .catch(() => message.error('获取变更统计失败'));
  };

  const handleSync = async () => {
    if (!id) return;
    setSyncing(true);
    try {
      await dataSourceApi.sync(id);
      message.success('同步请求已提交');
      // Refresh data
      const res: any = await dataSourceApi.get(id);
      setDs(res.data);
      fetchAccounts();
      fetchChanges();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '同步失败'));
    } finally {
      setSyncing(false);
    }
  };

  const handleTestConnection = async () => {
    if (!id) return;
    try {
      await dataSourceApi.testConnection(id);
      message.success('连接测试成功');
    } catch {
      message.error('连接测试失败');
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>;
  }

  if (!ds) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#8E8E93' }}>数据源不存在</div>;
  }

  const accountColumns = [
    { title: '账户ID', dataIndex: 'accountId', width: 140 },
    { title: '账户名', dataIndex: 'accountName', width: 160 },
    { title: '类型', dataIndex: 'accountType', width: 100,
      render: (v: string) => v ? <Tag>{v}</Tag> : '-',
    },
    { title: '部门', dataIndex: 'department', width: 120 },
    { title: '邮箱', dataIndex: 'email', width: 180 },
    { title: '状态', dataIndex: 'status', width: 80,
      render: (v: string) => {
        const color = v === 'active' ? 'green' : v === 'disabled' ? 'red' : 'default';
        return v ? <Tag color={color}>{v}</Tag> : '-';
      },
    },
  ];

  const tabItems = [
    {
      key: 'info',
      label: '基本信息',
      children: (
        <Descriptions bordered column={2} size="small" style={{ marginTop: 8 }}>
          <Descriptions.Item label="名称">{ds.name}</Descriptions.Item>
          <Descriptions.Item label="类型">
            <Tag color={ds.sourceType === 'CSV' ? 'cyan' : 'blue'}>{dataSourceTypeLabel(ds)}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={statusColors[ds.status]}>{statusLabels[ds.status] || ds.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="账户数量">{ds.totalAccounts?.toLocaleString() || '-'}</Descriptions.Item>
          <Descriptions.Item label="关联任务数">{ds.taskCount}</Descriptions.Item>
          <Descriptions.Item label="最后同步">{ds.lastSyncTime ? new Date(ds.lastSyncTime).toLocaleString('zh-CN') : '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{new Date(ds.createdAt).toLocaleString('zh-CN')}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{new Date(ds.updatedAt).toLocaleString('zh-CN')}</Descriptions.Item>
          {ds.connectionConfig && (
            <>
              <Descriptions.Item label="连接配置" span={2}>
                <pre style={{ fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify({ ...ds.connectionConfig, password: ds.connectionConfig.password ? '******' : undefined }, null, 2)}
                </pre>
              </Descriptions.Item>
            </>
          )}
          {ds.sourceType === 'CSV' && ds.csvConfig && (
            <Descriptions.Item label="最近 CSV" span={2}>
              {ds.csvConfig.needsReupload ? (
                <Tag color="orange">历史数据源，需重新上传一次</Tag>
              ) : (
                <Space wrap>
                  <Text>{ds.csvConfig.originalName}</Text>
                  <Tag>{ds.csvConfig.encoding}</Tag>
                  <Text type="secondary">{ds.csvConfig.rowCount || 0} 行</Text>
                  <Text type="secondary">{ds.csvConfig.importedAt ? new Date(ds.csvConfig.importedAt).toLocaleString('zh-CN') : '-'}</Text>
                </Space>
              )}
            </Descriptions.Item>
          )}
        </Descriptions>
      ),
    },
    {
      key: 'mapping',
      label: '字段映射',
      children: (
        <div style={{ marginTop: 8 }}>
          {ds.fieldMappingConfig && Object.keys(ds.fieldMappingConfig).length > 0 ? (
            <Table
              dataSource={Object.entries(ds.fieldMappingConfig).map(([k, v]) => ({ fieldName: k, sourceField: v }))}
              rowKey="fieldName"
              pagination={false}
              size="small"
              columns={[
                { title: '标准字段', dataIndex: 'fieldName', render: (v: string) => <Text code>{v}</Text> },
                {
                  title: '源字段', dataIndex: 'sourceField', render: (v: any) => {
                    const field = typeof v === 'string' ? v : v?.sourceField;
                    const convertCount = typeof v === 'object' && v?.convert ? Object.keys(v.convert).length : 0;
                    return field ? <Space><Text strong>{field}</Text>{convertCount > 0 && <Tag>{convertCount} 条值转换</Tag>}</Space> : <Text type="secondary">未映射</Text>;
                  },
                },
              ]}
            />
          ) : (
            <Text type="secondary">暂无字段映射配置</Text>
          )}
        </div>
      ),
    },
    {
      key: 'accounts',
      label: '账户数据',
      children: (
        <div style={{ marginTop: 8 }}>
          <Table
            columns={accountColumns}
            dataSource={accounts}
            rowKey="accountId"
            loading={accountsLoading}
            size="small"
            scroll={{ x: 800 }}
            locale={{ emptyText: '点击"加载数据"按钮查看账户预览' }}
          />
        </div>
      ),
    },
    {
      key: 'changes',
      label: '变更统计',
      children: (
        <div style={{ marginTop: 8 }}>
          {changes ? (
            <>
              <Row gutter={16} style={{ marginBottom: 20 }}>
                <Col span={8}>
                  <Card size="small" style={{ textAlign: 'center', borderRadius: 12 }}>
                    <Statistic title="新增账户" value={changes.newCount} prefix={<RiseOutlined style={{ color: '#34C759' }} />} />
                  </Card>
                </Col>
                <Col span={8}>
                  <Card size="small" style={{ textAlign: 'center', borderRadius: 12 }}>
                    <Statistic title="减少账户" value={changes.reducedCount} prefix={<FallOutlined style={{ color: '#FF3B30' }} />} />
                  </Card>
                </Col>
                <Col span={8}>
                  <Card size="small" style={{ textAlign: 'center', borderRadius: 12 }}>
                    <Statistic title="存量账户" value={changes.existingCount} prefix={<LineChartOutlined style={{ color: '#007AFF' }} />} />
                  </Card>
                </Col>
              </Row>
              {changes.changes && changes.changes.length > 0 && (
                <Table
                  dataSource={changes.changes}
                  rowKey="date"
                  size="small"
                  pagination={false}
                  columns={[
                    { title: '日期', dataIndex: 'date', width: 120 },
                    { title: '新增', dataIndex: 'newCount', width: 80 },
                    { title: '减少', dataIndex: 'reducedCount', width: 80 },
                    { title: '存量', dataIndex: 'existingCount', width: 80 },
                  ]}
                />
              )}
            </>
          ) : (
            <Text type="secondary" style={{ display: 'block', textAlign: 'center', padding: 20 }}>
              点击"加载数据"按钮查看变更统计
            </Text>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/account-audit/data-sources')} type="text" />
          <Title level={3} style={{ fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 24 }}>{ds.name}</Title>
          <Tag color={statusColors[ds.status]}>{statusLabels[ds.status] || ds.status}</Tag>
        </div>
        <Space>
          {ds.sourceType === 'DATABASE' && can('data_sources', 'update') && <Button icon={<LinkOutlined />} onClick={handleTestConnection}>测试连接</Button>}
          {ds.sourceType === 'DATABASE' && can('data_sources', 'sync') && <Button icon={<SyncOutlined />} loading={syncing} onClick={handleSync}>同步</Button>}
          {ds.sourceType === 'CSV' && can('data_sources', 'sync') && <Button icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>重新上传</Button>}
          {can('data_sources', 'update') && <Button icon={<EditOutlined />} onClick={() => navigate(`/account-audit/data-sources/${id}/edit`)}>编辑</Button>}
        </Space>
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.8)',
        backdropFilter: 'blur(20px)',
        borderRadius: 14,
        border: '0.5px solid rgba(0,0,0,0.06)',
        padding: '16px 20px',
      }}>
        <Tabs
          items={tabItems}
          onChange={(key) => {
            if (key === 'accounts') fetchAccounts();
            if (key === 'changes') fetchChanges();
          }}
        />
      </div>

      <CsvReuploadModal
        open={uploadOpen}
        source={ds}
        onClose={() => setUploadOpen(false)}
        onSuccess={async () => {
          if (!id) return;
          const response: any = await dataSourceApi.get(id);
          setDs(response.data);
          fetchAccounts();
          fetchChanges();
        }}
      />
    </div>
  );
}
