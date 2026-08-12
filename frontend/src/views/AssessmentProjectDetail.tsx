import { useEffect, useState } from 'react';
import { Button, Card, Descriptions, message, Progress, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import apiClient from '../api/client';
import { TASK_STATUS } from '../constants/status';
import { useAuthStore } from '../store/auth';
import { getApiErrorMessage } from '../utils/error';
import Findings from './Findings';

export default function AssessmentProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const can = useAuthStore((state) => state.hasPermission);
  const [task, setTask] = useState<any>();
  const [assets, setAssets] = useState<any[]>([]);
  const [risks, setRisks] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [auditorOptions, setAuditorOptions] = useState<any[]>([]);
  const [auditorIds, setAuditorIds] = useState<string[]>([]);

  const load = async () => {
    const [taskResponse, assetResponse]: any[] = await Promise.all([
      apiClient.get(`/tasks/${id}`), apiClient.get(`/tasks/${id}/assets`),
    ]);
    setTask(taskResponse.data);
    setAssets(assetResponse.data?.items || []);
    setAuditorIds((taskResponse.data?.auditors || []).map((item: any) => item.auditorUserId));
    if (can('risks', 'read')) apiClient.get('/risks', { params: { taskId: id, pageSize: 100 } }).then((response: any) => setRisks(response.data?.items || []));
    if (can('remediation_actions', 'read')) apiClient.get('/remediation-actions', { params: { pageSize: 100 } }).then((response: any) => setActions((response.data?.items || []).filter((action: any) =>
      [...(action.findingLinks || []).map((link: any) => link.finding?.taskId), ...(action.riskLinks || []).map((link: any) => link.risk?.taskId)].includes(id))));
    if (can('audit_logs', 'read')) apiClient.get('/audit-logs', { params: { resourceId: id, pageSize: 100 } }).then((response: any) => setLogs(response.data?.items || []));
  };
  useEffect(() => {
    void load();
    if (can('tasks', 'update')) apiClient.get('/lookup/auditors').then((response: any) => setAuditorOptions(response.data || []));
  }, [id]);

  const saveAuditors = async () => {
    try { await apiClient.put(`/tasks/${id}/auditors`, { auditorUserIds: auditorIds }); message.success('审计员池已更新'); await load(); }
    catch (error) { message.error(getApiErrorMessage(error, '保存失败')); }
  };
  const close = async () => {
    try { await apiClient.post(`/tasks/${id}/close`); message.success('评估项目已关闭'); await load(); }
    catch (error) { message.error(getApiErrorMessage(error, '仍有未完成的闭环事项，暂不能关闭')); }
  };
  if (!task) return null;
  const status = TASK_STATUS[task.status] || { color: 'default', text: task.status };
  const percent = task.progress?.total ? Math.round(task.progress.reviewed / task.progress.total * 100) : 0;
  const currentTab = params.get('tab') || 'overview';
  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <div><Typography.Title level={3} style={{ margin: 0 }}>{task.name}</Typography.Title><Space><Tag color={status.color}>{status.text}</Tag><Typography.Text type="secondary">{task.template?.name}</Typography.Text></Space></div>
        <Space>{can('tasks', 'update') && task.status === 'pending_closure' && <Button type="primary" onClick={close}>关闭评估</Button>}<Button onClick={() => navigate('/assessments')}>返回项目列表</Button></Space>
      </Space>
      <Tabs activeKey={currentTab} onChange={(tab) => setParams(tab === 'overview' ? {} : { tab })} items={[
        { key: 'overview', label: '概览', children: <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <Card><Descriptions column={2} items={[
            { key: 'target', label: '评估对象', children: task.assessmentTarget },
            { key: 'period', label: '评估周期', children: task.periodStart ? `${task.periodStart} 至 ${task.periodEnd || '-'}` : '-' },
            { key: 'auditors', label: '审计员', children: (task.auditors || []).map((item: any) => item.auditor?.username).filter(Boolean).join('、') || '-' },
            { key: 'progress', label: '评估进度', children: `${task.progress?.reviewed || 0} / ${task.progress?.total || 0}` },
          ]} /><Progress percent={percent} status="active" /></Card>
          {can('tasks', 'update') && <Card title="审计员池"><Space.Compact style={{ width: '100%' }}><Select mode="multiple" value={auditorIds} onChange={setAuditorIds} style={{ width: '100%' }} options={auditorOptions.map((item) => ({ value: item.userId, label: item.displayName || item.username }))} /><Button type="primary" onClick={saveAuditors}>保存</Button></Space.Compact></Card>}
        </Space> },
        { key: 'scope', label: '评估范围', children: <Table rowKey="id" dataSource={assets} columns={[
          { title: '资产编码', dataIndex: 'assetCodeSnapshot' }, { title: '资产名称', dataIndex: 'assetNameSnapshot' },
          { title: '类型', dataIndex: 'assetTypeSnapshot' }, { title: '归属部门', dataIndex: 'ownerDepartmentNameSnapshot', render: (value) => value || '-' },
        ]} /> },
        { key: 'units', label: '评估表', children: <Card><Typography.Paragraph>在同一张评估表中逐行填写；每个控制项默认关联项目全部资产，也可在提交前调整或拆分。</Typography.Paragraph><Button type="primary" onClick={() => navigate(`/assessments/${id}/workbench`)}>进入评估表</Button></Card> },
        { key: 'findings', label: `不符合项 ${task.progress?.findings || 0}`, children: can('findings', 'read') ? <Findings taskId={id} /> : <Typography.Text type="secondary">无查看权限</Typography.Text> },
        { key: 'governance', label: '风险与整改', children: <Space direction="vertical" style={{ width: '100%' }} size={18}>
          <Typography.Title level={5}>风险</Typography.Title><Table rowKey="id" dataSource={risks} columns={[{ title: '编号', dataIndex: 'code' }, { title: '风险', dataIndex: 'title' }, { title: '状态', dataIndex: 'status' }]} />
          <Typography.Title level={5}>整改行动</Typography.Title><Table rowKey="id" dataSource={actions} columns={[{ title: '编号', dataIndex: 'code' }, { title: '整改行动', dataIndex: 'title' }, { title: '状态', dataIndex: 'status' }]} />
        </Space> },
        { key: 'logs', label: '操作记录', children: can('audit_logs', 'read') ? <Table rowKey="id" dataSource={logs} columns={[
          { title: '时间', dataIndex: 'createdAt', render: (value) => new Date(value).toLocaleString('zh-CN') }, { title: '操作', dataIndex: 'operationType' }, { title: '说明', dataIndex: 'operationDetails' },
        ]} /> : <Typography.Text type="secondary">无查看权限</Typography.Text> },
      ]} />
    </div>
  );
}
