import { useState, useEffect } from 'react';
import { Table, Button, Tag, Select, Typography, Space, message, DatePicker, Input, Drawer } from 'antd';
import { ExportOutlined, SearchOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { problemApi, type Problem } from '../../api/account';
import { getApiErrorMessage } from '../../utils/error';
import ProblemDetail from './ProblemDetail';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const severityColors: Record<string, string> = { HIGH: 'red', MEDIUM: 'orange', LOW: 'green' };
const severityLabels: Record<string, string> = { HIGH: '高', MEDIUM: '中', LOW: '低' };
const statusColors: Record<string, string> = { PENDING: 'red', PROCESSING: 'orange', RESOLVED: 'green', AUTO_RESOLVED: 'blue', FALSE_POSITIVE: 'default', IGNORED: 'default' };
const statusLabels: Record<string, string> = { PENDING: '待处理', PROCESSING: '处理中', RESOLVED: '已解决', AUTO_RESOLVED: '自动修复', FALSE_POSITIVE: '误报', IGNORED: '已忽略' };

export default function ProblemList() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Filters
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [ruleIdFilter, setRuleIdFilter] = useState<string>('');
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);
  const [keyword, setKeyword] = useState('');

  // Selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Detail Drawer
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const fetchProblems = () => {
    setLoading(true);
    const params: any = { page, pageSize };
    if (severityFilter) params.severity = severityFilter;
    if (statusFilter) params.status = statusFilter;
    if (ruleIdFilter) params.ruleId = ruleIdFilter;
    if (keyword) params.keyword = keyword;
    if (dateRange) {
      params.startDate = dateRange[0];
      params.endDate = dateRange[1];
    }
    problemApi.list(params)
      .then((res: any) => {
        setProblems(res.data?.items || []);
        setTotal(res.data?.pagination?.total || 0);
      })
      .catch(() => message.error('获取问题列表失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchProblems(); }, [page, pageSize, severityFilter, statusFilter, ruleIdFilter]);

  const handleSearch = () => {
    setPage(1);
    fetchProblems();
  };

  const handleBulkUpdate = async (status: string) => {
    if (selectedIds.length === 0) {
      message.warning('请先选择问题');
      return;
    }
    try {
      await problemApi.bulkUpdate({ ids: selectedIds, status });
      message.success(`已将 ${selectedIds.length} 个问题标记为${statusLabels[status]}`);
      setSelectedIds([]);
      fetchProblems();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '批量更新失败'));
    }
  };

  const handleExport = async () => {
    try {
      const params: any = {};
      if (severityFilter) params.severity = severityFilter;
      if (statusFilter) params.status = statusFilter;
      if (dateRange) { params.startDate = dateRange[0]; params.endDate = dateRange[1]; }
      const res = await problemApi.export(params);
      const url = window.URL.createObjectURL(new Blob([res as any]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'problems-export.xlsx';
      a.click();
      message.success('导出成功');
    } catch {
      message.error('导出失败');
    }
  };

  const columns = [
    {
      title: '账户ID', dataIndex: 'accountId', width: 120,
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: '账户名', dataIndex: 'accountName', width: 130,
      render: (v: string, record: Problem) => (
        <a onClick={() => { setDetailId(record.id); setDetailVisible(true); }} style={{ fontWeight: 500 }}>{v}</a>
      ),
    },
    {
      title: '规则', dataIndex: 'ruleName', width: 150, ellipsis: true,
    },
    {
      title: '问题描述', dataIndex: 'problemDescription', width: 200, ellipsis: true,
    },
    {
      title: '严重度', dataIndex: 'severity', width: 75,
      render: (v: string) => <Tag color={severityColors[v]}>{severityLabels[v]}</Tag>,
    },
    {
      title: '状态', dataIndex: 'status', width: 85,
      render: (v: string) => <Tag color={statusColors[v]}>{statusLabels[v]}</Tag>,
    },
    {
      title: '首次检测', dataIndex: 'firstDetectedAt', width: 150,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作', width: 80,
      render: (_: any, record: Problem) => (
        <Button size="small" onClick={() => { setDetailId(record.id); setDetailVisible(true); }}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 24 }}>问题列表</Title>
        <Space>
          <Button icon={<ExportOutlined />} onClick={handleExport}>导出</Button>
        </Space>
      </div>

      {/* Filters */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Input
          placeholder="搜索账户或描述"
          prefix={<SearchOutlined style={{ color: '#AEAEB2' }} />}
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onPressEnter={handleSearch}
          style={{ width: 200 }}
          allowClear
        />
        <Select
          placeholder="严重度"
          value={severityFilter || undefined}
          onChange={v => { setSeverityFilter(v || ''); setPage(1); }}
          allowClear
          style={{ width: 100 }}
          options={[
            { value: 'high', label: '高' },
            { value: 'medium', label: '中' },
            { value: 'low', label: '低' },
          ]}
        />
        <Select
          placeholder="状态"
          value={statusFilter || undefined}
          onChange={v => { setStatusFilter(v || ''); setPage(1); }}
          allowClear
          style={{ width: 110 }}
          options={[
            { value: 'open', label: '未处理' },
            { value: 'acknowledged', label: '已确认' },
            { value: 'resolved', label: '已解决' },
            { value: 'false_positive', label: '误报' },
          ]}
        />
        <RangePicker
          size="middle"
          placeholder={['开始日期', '结束日期']}
          style={{ width: 240 }}
          onChange={(dates, dateStrings) => {
            if (dates) {
              setDateRange([dateStrings[0], dateStrings[1]]);
            } else {
              setDateRange(null);
            }
          }}
        />
        <Button onClick={handleSearch}>查询</Button>
      </div>

      {/* Bulk Actions */}
      {selectedIds.length > 0 && (
        <div style={{
          marginBottom: 12,
          padding: '8px 12px',
          background: 'rgba(0,122,255,0.06)',
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <Text strong style={{ fontSize: 13 }}>已选 {selectedIds.length} 项</Text>
          <Button size="small" onClick={() => handleBulkUpdate('resolved')}>标记为已解决</Button>
          <Button size="small" onClick={() => handleBulkUpdate('acknowledged')}>标记为已确认</Button>
          <Button size="small" onClick={() => handleBulkUpdate('false_positive')}>标记为误报</Button>
          <Button size="small" onClick={() => setSelectedIds([])}>取消选择</Button>
        </div>
      )}

      <Table
        columns={columns}
        dataSource={problems}
        rowKey="id"
        loading={loading}
        size="small"
        scroll={{ x: 1000 }}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys as string[]),
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />

      <ProblemDetail
        visible={detailVisible}
        problemId={detailId}
        onClose={() => { setDetailVisible(false); setDetailId(null); }}
        onStatusUpdated={fetchProblems}
      />
    </div>
  );
}
