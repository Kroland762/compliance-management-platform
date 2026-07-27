import { useState, useEffect, useCallback } from 'react';
import { Table, Tag, Input, Select, DatePicker, Button, Space, Card } from 'antd';
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import apiClient from '../../api/client';

const { RangePicker } = DatePicker;

const OPERATION_TYPES = [
  { label: '全部', value: '' },
  { label: '创建', value: 'create' },
  { label: '更新', value: 'update' },
  { label: '删除', value: 'delete' },
  { label: '查询', value: 'query' },
  { label: '登录', value: 'login' },
  { label: '登出', value: 'logout' },
];

const RESOURCE_TYPES = [
  { label: '全部', value: '' },
  { label: '用户', value: 'user' },
  { label: '角色', value: 'role' },
  { label: '任务', value: 'task' },
  { label: '模板', value: 'template' },
  { label: '租户', value: 'tenant' },
  { label: '资质', value: 'qualification' },
  { label: '数据源', value: 'data_source' },
  { label: '审计规则', value: 'audit_rule' },
  { label: '审计任务', value: 'audit_task' },
  { label: '问题账号', value: 'problem_account' },
];

interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export default function AuditLogViewer() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, pageSize: 20, total: 0, totalPages: 0 });

  // 筛选条件
  const [operationType, setOperationType] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null]>([null, null]);
  const [userSearch, setUserSearch] = useState('');

  const fetchLogs = useCallback((page = 1, pageSize = 20) => {
    setLoading(true);
    const params: Record<string, any> = { page, pageSize };
    if (operationType) params.operationType = operationType;
    if (resourceType) params.resourceType = resourceType;
    if (dateRange[0]) params.startDate = dateRange[0].toISOString();
    if (dateRange[1]) params.endDate = dateRange[1].endOf('day').toISOString();
    if (userSearch.trim()) params.userSearch = userSearch.trim();

    apiClient.get('/audit-logs', { params })
      .then((res: any) => {
        setLogs(res.data?.items || []);
        if (res.data?.pagination) setPagination(res.data.pagination);
      })
      .finally(() => setLoading(false));
  }, [operationType, resourceType, dateRange, userSearch]);

  useEffect(() => {
    fetchLogs(1);
  }, []);

  const handleSearch = () => fetchLogs(1);
  const handleReset = () => {
    setOperationType('');
    setResourceType('');
    setDateRange([null, null]);
    setUserSearch('');
    setTimeout(() => fetchLogs(1), 0);
  };

  const handlePageChange = (page: number, pageSize: number) => fetchLogs(page, pageSize);

  const columns = [
    { title: '时间', dataIndex: 'createdAt', width: 180, render: (v: string) => new Date(v).toLocaleString() },
    { title: '用户', dataIndex: 'user', width: 120, render: (u: any) => u?.username || '-' },
    { title: '操作类型', dataIndex: 'operationType', width: 100, render: (v: string) => {
      const colorMap: Record<string, string> = { create: 'green', update: 'blue', delete: 'red', query: 'default', login: 'purple', logout: 'orange' };
      return <Tag color={colorMap[v] || 'default'}>{v}</Tag>;
    }},
    { title: '资源类型', dataIndex: 'resourceType', width: 120 },
    { title: '详情', dataIndex: 'operationDetails', ellipsis: true },
    { title: '结果', dataIndex: 'success', width: 80, render: (v: boolean) => v ? <Tag color="green">成功</Tag> : <Tag color="red">失败</Tag> },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            placeholder="操作类型"
            value={operationType}
            onChange={setOperationType}
            options={OPERATION_TYPES}
            style={{ minWidth: 110 }}
            allowClear
          />
          <Select
            placeholder="资源类型"
            value={resourceType}
            onChange={setResourceType}
            options={RESOURCE_TYPES}
            style={{ minWidth: 130 }}
            allowClear
          />
          <RangePicker
            value={dateRange}
            onChange={(v) => setDateRange(v as [Dayjs | null, Dayjs | null])}
            placeholder={['开始日期', '结束日期']}
          />
          <Input
            placeholder="搜索用户"
            prefix={<SearchOutlined />}
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            style={{ minWidth: 160 }}
            allowClear
            onPressEnter={handleSearch}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>查询</Button>
          <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
        </Space>
      </Card>

      <Table
        columns={columns}
        dataSource={logs}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{
          current: pagination.page,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: handlePageChange,
        }}
      />
    </div>
  );
}
