import { useEffect, useState } from 'react';
import { Alert, Breadcrumb, Button, Card, Descriptions, Empty, Progress, Result, Skeleton, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import apiClient from '../api/client';
import { TASK_STATUS } from '../constants/status';
import { useAuthStore } from '../store/auth';
import { getApiErrorMessage } from '../utils/error';
import Findings from './Findings';
import { AuditorSelect } from '../components/lookups';

export default function AssessmentProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const can = useAuthStore((state) => state.hasPermission);
  const [task, setTask] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [secondaryWarnings, setSecondaryWarnings] = useState<string[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [risks, setRisks] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [auditorIds, setAuditorIds] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    setSecondaryWarnings([]);
    try {
      const taskResponse: any = await apiClient.get(`/tasks/${id}`);
      setTask(taskResponse.data);
      setAuditorIds((taskResponse.data?.auditors || []).map((item: any) => item.auditorUserId));
    } catch (error) {
      setTask(undefined);
      setLoadError(getApiErrorMessage(error, '无法加载评估项目'));
      setLoading(false);
      return;
    }

    setLoading(false);
    setAssets([]);
    setRisks([]);
    setActions([]);
    setLogs([]);

    const requests: Array<{ label: string; request: Promise<any>; apply: (response: any) => void }> = [
      {
        label: '评估范围',
        request: apiClient.get(`/tasks/${id}/assets`),
        apply: (response) => setAssets(response.data?.items || []),
      },
    ];
    if (can('risks', 'read')) requests.push({
      label: '风险',
      request: apiClient.get('/risks', { params: { taskId: id, pageSize: 100 } }),
      apply: (response) => setRisks(response.data?.items || []),
    });
    if (can('remediation_actions', 'read')) requests.push({
      label: '整改行动',
      request: apiClient.get('/remediation-actions', { params: { pageSize: 100 } }),
      apply: (response) => setActions((response.data?.items || []).filter((action: any) =>
        [...(action.findingLinks || []).map((link: any) => link.finding?.taskId), ...(action.riskLinks || []).map((link: any) => link.risk?.taskId)].includes(id))),
    });
    if (can('audit_logs', 'read')) requests.push({
      label: '操作记录',
      request: apiClient.get('/audit-logs', { params: { resourceId: id, pageSize: 100 } }),
      apply: (response) => setLogs(response.data?.items || []),
    });

    const results = await Promise.allSettled(requests.map((item) => item.request));
    const warnings: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') requests[index].apply(result.value);
      else warnings.push(requests[index].label);
    });
    setSecondaryWarnings(warnings);
  };
  useEffect(() => {
    void load();
  }, [id]);

  const saveAuditors = async () => {
    try { await apiClient.put(`/tasks/${id}/auditors`, { auditorUserIds: auditorIds }); message.success('审计员池已更新'); await load(); }
    catch (error) { message.error(getApiErrorMessage(error, '保存失败')); }
  };
  const close = async () => {
    try { await apiClient.post(`/tasks/${id}/close`); message.success('评估项目已关闭'); await load(); }
    catch (error) { message.error(getApiErrorMessage(error, '仍有未完成的闭环事项，暂不能关闭')); }
  };
  const breadcrumb = <Breadcrumb style={{ marginBottom: 16 }} items={[
    { title: <Link to="/assessments">评估项目</Link> },
    { title: task?.name || '项目详情' },
  ]} />;

  if (loading) return <div>{breadcrumb}<Card><Skeleton active paragraph={{ rows: 6 }} /></Card></div>;
  if (loadError || !task) return (
    <div>
      {breadcrumb}
      <Card>
        <Result
          status="error"
          title="无法加载评估项目"
          subTitle={loadError || '项目不存在或暂时不可访问'}
          extra={[
            <Button key="retry" type="primary" onClick={() => void load()}>重试</Button>,
            <Button key="back" onClick={() => navigate('/assessments')}>返回项目列表</Button>,
          ]}
        />
      </Card>
    </div>
  );
  const status = TASK_STATUS[task.status] || { color: 'default', text: task.status };
  const percent = task.progress?.total ? Math.round(task.progress.reviewed / task.progress.total * 100) : 0;
  const currentTab = params.get('tab') || 'overview';
  return (
    <div>
      {breadcrumb}
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <div><Typography.Title level={3} style={{ margin: 0 }}>{task.name}</Typography.Title><Space><Tag color={status.color}>{status.text}</Tag><Typography.Text type="secondary">{task.template?.name}</Typography.Text></Space></div>
        <Space>{can('tasks', 'update') && task.status === 'pending_closure' && <Button type="primary" onClick={close}>关闭评估</Button>}<Button onClick={() => navigate('/assessments')}>返回项目列表</Button></Space>
      </Space>
      {secondaryWarnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="部分信息加载失败"
          description={`未能加载：${secondaryWarnings.join('、')}。项目基本信息仍可正常查看。`}
          action={<Button size="small" onClick={() => void load()}>重新加载</Button>}
          style={{ marginBottom: 16 }}
        />
      )}
      <Tabs activeKey={currentTab} onChange={(tab) => setParams(tab === 'overview' ? {} : { tab })} items={[
        { key: 'overview', label: '概览', children: <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <Card><Descriptions column={2} items={[
            { key: 'target', label: '评估对象', children: task.assessmentTarget },
            { key: 'period', label: '评估周期', children: task.periodStart ? `${task.periodStart} 至 ${task.periodEnd || '-'}` : '-' },
            { key: 'auditors', label: '审计员', children: (task.auditors || []).map((item: any) => item.auditor?.username).filter(Boolean).join('、') || '-' },
            { key: 'progress', label: '评估进度', children: `${task.progress?.reviewed || 0} / ${task.progress?.total || 0}` },
          ]} /><Progress percent={percent} status="active" /></Card>
          {can('tasks', 'update') && <Card title="审计员池"><Space.Compact style={{ width: '100%' }}><AuditorSelect contextId={id} mode="multiple" value={auditorIds} onChange={setAuditorIds} style={{ width: '100%' }} /><Button type="primary" onClick={saveAuditors}>保存</Button></Space.Compact></Card>}
        </Space> },
        { key: 'scope', label: '评估范围', children: <Table rowKey="id" dataSource={assets} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无评估范围" /> }} columns={[
          { title: '资产编码', dataIndex: 'assetCodeSnapshot' }, { title: '资产名称', dataIndex: 'assetNameSnapshot' },
          { title: '类型', dataIndex: 'assetTypeSnapshot' }, { title: '归属部门', dataIndex: 'ownerDepartmentNameSnapshot', render: (value) => value || '-' },
        ]} /> },
        { key: 'units', label: '评估表', children: <Card><Typography.Paragraph>在同一张评估表中逐行填写；每个控制项默认关联项目全部资产，也可在提交前调整或拆分。</Typography.Paragraph><Button type="primary" onClick={() => navigate(`/assessments/${id}/workbench`)}>进入评估表</Button></Card> },
        { key: 'findings', label: `不符合项 ${task.progress?.findings || 0}`, children: can('findings', 'read') ? <Findings taskId={id} /> : <Typography.Text type="secondary">无查看权限</Typography.Text> },
        { key: 'governance', label: '风险与整改', children: <Space direction="vertical" style={{ width: '100%' }} size={18}>
          <Typography.Title level={5}>风险</Typography.Title><Table rowKey="id" dataSource={risks} locale={{ emptyText: '暂无风险' }} columns={[{ title: '编号', dataIndex: 'code' }, { title: '风险', dataIndex: 'title' }, { title: '状态', dataIndex: 'status' }]} />
          <Typography.Title level={5}>整改行动</Typography.Title><Table rowKey="id" dataSource={actions} locale={{ emptyText: '暂无整改行动' }} columns={[{ title: '编号', dataIndex: 'code' }, { title: '整改行动', dataIndex: 'title' }, { title: '状态', dataIndex: 'status' }]} />
        </Space> },
        { key: 'logs', label: '操作记录', children: can('audit_logs', 'read') ? <Table rowKey="id" dataSource={logs} locale={{ emptyText: '暂无操作记录' }} columns={[
          { title: '时间', dataIndex: 'createdAt', render: (value) => new Date(value).toLocaleString('zh-CN') }, { title: '操作', dataIndex: 'operationType' }, { title: '说明', dataIndex: 'operationDetails' },
        ]} /> : <Typography.Text type="secondary">无查看权限</Typography.Text> },
      ]} />
    </div>
  );
}
