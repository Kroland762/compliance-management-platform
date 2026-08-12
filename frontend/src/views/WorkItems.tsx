import { useEffect, useState } from 'react';
import { Button, Empty, message, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../utils/error';

const statusText: Record<string, string> = {
  pending: '待填写', in_progress: '填写中', returned: '已退回', submitted: '待复核',
  not_started: '待开始', pending_verification: '待验证',
};

export default function WorkItems() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>({ fill: [], review: [], remediate: [], verify: [], counts: {} });
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const response: any = await apiClient.get('/work-items');
      setData(response.data || { fill: [], review: [], remediate: [], verify: [], counts: {} });
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const claim = async (item: any) => {
    try {
      await apiClient.post(`/evaluations/${item.id}/review-claim`);
      message.success('已认领，可开始复核');
      await load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '认领失败，该单元可能已被其他审计员认领'));
      await load();
    }
  };

  const evaluationColumns: any[] = [
    { title: '项目', render: (_: any, item: any) => item.task?.name || '-' },
    { title: '控制项', render: (_: any, item: any) => `${item.sequenceNumber} · ${item.controlPoint}` },
    { title: '资产', render: (_: any, item: any) => `${item.asset?.code || ''} · ${item.asset?.name || ''}` },
    { title: '状态', dataIndex: 'workflowStatus', width: 100, render: (value: string) => <Tag>{statusText[value] || value}</Tag> },
  ];
  const empty = <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待办" />;

  return (
    <div>
      <Typography.Title level={3} style={{ marginBottom: 4 }}>我的待办</Typography.Title>
      <Typography.Text type="secondary">只展示需要当前账号处理的评估、复核、整改和验证事项</Typography.Text>
      <Tabs style={{ marginTop: 20 }} items={[
        {
          key: 'fill', label: `待填写 ${data.counts?.fill || 0}`,
          children: data.fill?.length ? <Table rowKey="id" loading={loading} dataSource={data.fill} columns={[
            ...evaluationColumns,
            { title: '操作', width: 100, render: (_: any, item: any) => <Button type="primary" size="small" onClick={() => navigate(`/assessments/${item.taskId}/workbench`)}>去填写</Button> },
          ]} /> : empty,
        },
        {
          key: 'review', label: `待复核 ${data.counts?.review || 0}`,
          children: data.review?.length ? <Table rowKey="id" loading={loading} dataSource={data.review} columns={[
            ...evaluationColumns,
            { title: '认领状态', width: 110, render: (_: any, item: any) => item.reviewClaimedBy ? <Tag color="blue">我已认领</Tag> : <Tag>共享池</Tag> },
            { title: '操作', width: 180, render: (_: any, item: any) => <Space>{!item.reviewClaimedBy && <Button size="small" onClick={() => claim(item)}>认领</Button>}<Button type="primary" size="small" disabled={!item.reviewClaimedBy} onClick={() => navigate(`/assessments/${item.taskId}/workbench`)}>去复核</Button></Space> },
          ]} /> : empty,
        },
        {
          key: 'remediate', label: `待整改 ${data.counts?.remediate || 0}`,
          children: data.remediate?.length ? <Table rowKey="id" loading={loading} dataSource={data.remediate} columns={[
            { title: '编号', dataIndex: 'code', width: 190 }, { title: '整改行动', dataIndex: 'title' },
            { title: '期限', dataIndex: 'dueDate', width: 120 },
            { title: '状态', dataIndex: 'status', width: 120, render: (value: string) => <Tag>{statusText[value] || value}</Tag> },
            { title: '操作', width: 100, render: (_: any, item: any) => <Button type="primary" size="small" onClick={() => navigate(`/remediation-actions/${item.id}`)}>去整改</Button> },
          ]} /> : empty,
        },
        {
          key: 'verify', label: `待验证 ${data.counts?.verify || 0}`,
          children: data.verify?.length ? <Table rowKey="id" loading={loading} dataSource={data.verify} columns={[
            { title: '编号', dataIndex: 'code', width: 190 }, { title: '整改行动', dataIndex: 'title' },
            { title: '提交时间', dataIndex: 'submittedAt', width: 180, render: (value: string) => value ? new Date(value).toLocaleString('zh-CN') : '-' },
            { title: '来源', render: (_: any, item: any) => [...(item.findingLinks || []).map((link: any) => link.finding?.code), ...(item.riskLinks || []).map((link: any) => link.risk?.code)].filter(Boolean).join('、') },
            { title: '操作', width: 100, render: (_: any, item: any) => <Button type="primary" size="small" onClick={() => navigate(`/remediation-actions/${item.id}`)}>去验证</Button> },
          ]} /> : empty,
        },
      ]} />
    </div>
  );
}
