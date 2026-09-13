import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, DatePicker, Input, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import apiClient from '../api/client';
import { RISK_CREATION_MODE, RISK_DISCOVERY_SOURCE, RISK_LEVEL, RISK_STATUS, TREATMENT_STRATEGY } from '../constants/status';
import { useAuthStore } from '../store/auth';
import { getApiErrorMessage } from '../utils/error';
import { DepartmentSelect } from '../components/lookups';

const actionStatus: Record<string, string> = { draft: '草稿', not_started: '待开始', in_progress: '整改中', pending_verification: '待验证', completed: '已完成', cancelled: '已取消' };

export default function RiskAndRemediation() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const can = useAuthStore((state) => state.hasPermission);
  const [risks, setRisks] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });
  const [filters, setFilters] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const loadRisks = async (page = pagination.page, nextFilters = filters) => {
    setLoading(true); setError('');
    try {
      const response: any = await apiClient.get('/risks', { params: { ...nextFilters, page, pageSize: pagination.pageSize } });
      setRisks(response.data?.items || []);
      setPagination((current) => ({ ...current, page, total: response.data?.pagination?.total || 0 }));
    } catch (loadError) { setError(getApiErrorMessage(loadError, '风险台账加载失败')); }
    finally { setLoading(false); }
  };
  const loadActions = async () => {
    try { const response: any = await apiClient.get('/remediation-actions', { params: { pageSize: 100 } }); setActions(response.data?.items || []); }
    catch (loadError) { setError(getApiErrorMessage(loadError, '整改行动加载失败')); }
  };
  useEffect(() => { if (can('risks', 'read')) void loadRisks(1, {}); if (can('remediation_actions', 'read')) void loadActions(); }, []);
  const applyFilters = (patch: Record<string, unknown>) => {
    const next = { ...filters, ...patch };
    Object.keys(next).forEach((key) => { if (next[key] === undefined || next[key] === '') delete next[key]; });
    setFilters(next); void loadRisks(1, next);
  };
  const initial = params.get('tab') === 'remediation' ? 'remediation' : (can('risks', 'read') ? 'risks' : 'remediation');
  const riskTable = <>
    <Space wrap style={{ marginBottom: 16 }}>
      <Input.Search allowClear placeholder="风险编号或标题" style={{ width: 260 }} onSearch={(keyword) => applyFilters({ keyword })} />
      <Select allowClear placeholder="发现来源" style={{ width: 160 }} onChange={(discoverySource) => applyFilters({ discoverySource })} options={Object.entries(RISK_DISCOVERY_SOURCE).map(([value, label]) => ({ value, label }))} />
      <Select allowClear placeholder="创建方式" style={{ width: 150 }} onChange={(creationMode) => applyFilters({ creationMode })} options={Object.entries(RISK_CREATION_MODE).map(([value, label]) => ({ value, label }))} />
      <Select allowClear placeholder="状态" style={{ width: 140 }} onChange={(status) => applyFilters({ status })} options={Object.entries(RISK_STATUS).map(([value, item]) => ({ value, label: item.text }))} />
      <Select allowClear placeholder="等级" style={{ width: 120 }} onChange={(riskLevel) => applyFilters({ riskLevel })} options={Object.entries(RISK_LEVEL).map(([value, item]) => ({ value, label: item.text }))} />
      <Select allowClear placeholder="策略" style={{ width: 120 }} onChange={(treatmentStrategy) => applyFilters({ treatmentStrategy })} options={Object.entries(TREATMENT_STRATEGY).map(([value, label]) => ({ value, label }))} />
      <DepartmentSelect allowClear purpose="risk-filter" placeholder="责任部门" style={{ width: 180 }} onChange={(ownerDepartmentId) => applyFilters({ ownerDepartmentId })} />
      <DatePicker.RangePicker onChange={(dates) => applyFilters({ dateFrom: dates?.[0]?.format('YYYY-MM-DD'), dateTo: dates?.[1]?.format('YYYY-MM-DD') })} />
      <Checkbox onChange={(event) => applyFilters({ mine: event.target.checked || undefined })}>与我相关</Checkbox>
      <Checkbox onChange={(event) => applyFilters({ overdue: event.target.checked || undefined })}>已逾期</Checkbox>
      <Button icon={<ReloadOutlined />} onClick={() => void loadRisks()}>刷新</Button>
    </Space>
    {error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => void loadRisks()}>重试</Button>} style={{ marginBottom: 16 }} />}
    <Table rowKey="id" loading={loading} dataSource={risks} locale={{ emptyText: '暂无风险记录' }} pagination={{ current: pagination.page, pageSize: pagination.pageSize, total: pagination.total, showTotal: (total) => `共 ${total} 条`, onChange: (page) => void loadRisks(page) }} columns={[
      { title: '编号', dataIndex: 'code', width: 190, render: (value: string, item: any) => <Link to={`/risks/${item.id}`}>{value}</Link> },
      { title: '风险', dataIndex: 'title' },
      { title: '发现来源', dataIndex: 'discoverySource', width: 130, render: (value: string) => RISK_DISCOVERY_SOURCE[value] || value },
      { title: '等级', dataIndex: 'riskLevel', width: 90, render: (value: string) => <Tag color={RISK_LEVEL[value]?.color}>{RISK_LEVEL[value]?.text || value}</Tag> },
      { title: '责任部门', width: 150, render: (_: any, item: any) => item.ownerDepartment?.name || '—' },
      { title: '负责人', width: 120, render: (_: any, item: any) => item.owner?.displayName || '—' },
      { title: '状态', dataIndex: 'status', width: 120, render: (value: string) => <Tag color={RISK_STATUS[value]?.color}>{RISK_STATUS[value]?.text || value}</Tag> },
      { title: '期限', dataIndex: 'dueDate', width: 120, render: (value: string) => value || '—' },
    ]} />
  </>;
  return <div>
    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
      <div><Typography.Title level={3} style={{ marginBottom: 4 }}>风险与整改</Typography.Title><Typography.Text type="secondary">统一管理评估发现和日常运维等独立来源的风险</Typography.Text></div>
      {can('risks', 'create') && <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/risks/new')}>新增风险</Button>}
    </Space>
    <Tabs activeKey={initial} onChange={(key) => setParams(key === 'remediation' ? { tab: 'remediation' } : {})} style={{ marginTop: 20 }} items={[
      ...(can('risks', 'read') ? [{ key: 'risks', label: '风险', children: riskTable }] : []),
      ...(can('remediation_actions', 'read') ? [{ key: 'remediation', label: '整改行动', children: <Table rowKey="id" dataSource={actions} columns={[
        { title: '编号', dataIndex: 'code', width: 190, render: (value: string, item: any) => <Link to={`/remediation-actions/${item.id}`}>{value}</Link> }, { title: '整改行动', dataIndex: 'title' },
        { title: '风险', width: 80, render: (_: any, item: any) => item.riskLinks?.length || 0 }, { title: '状态', dataIndex: 'status', width: 130, render: (value: string) => <Tag>{actionStatus[value] || value}</Tag> }, { title: '期限', dataIndex: 'dueDate', width: 120 },
      ]} /> }] : []),
    ]} />
  </div>;
}
