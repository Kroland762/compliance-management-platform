import { useEffect, useState } from 'react';
import { Table, Tabs, Tag, Typography } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';
import { RISK_LEVEL } from '../constants/status';

const riskStatus: Record<string, string> = {
  draft: '草稿', pending_confirmation: '待确认', open: '已识别', remediating: '整改中',
  pending_verification: '待验证', closed: '已关闭', accepted: '已接受', cancelled: '已取消',
};
const actionStatus: Record<string, string> = {
  draft: '草稿', not_started: '待开始', in_progress: '整改中', pending_verification: '待验证',
  completed: '已完成', cancelled: '已取消',
};

export default function RiskAndRemediation() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const can = useAuthStore((state) => state.hasPermission);
  const [risks, setRisks] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  useEffect(() => {
    if (can('risks', 'read')) apiClient.get('/risks', { params: { pageSize: 100 } }).then((response: any) => setRisks(response.data?.items || []));
    if (can('remediation_actions', 'read')) apiClient.get('/remediation-actions', { params: { pageSize: 100 } }).then((response: any) => setActions(response.data?.items || []));
  }, []);
  const initial = params.get('tab') === 'remediation' ? 'remediation' : (can('risks', 'read') ? 'risks' : 'remediation');
  return (
    <div>
      <Typography.Title level={3} style={{ marginBottom: 4 }}>风险与整改</Typography.Title>
      <Typography.Text type="secondary">集中查看由不符合项升级的风险和关联整改行动</Typography.Text>
      <Tabs activeKey={initial} onChange={(key) => setParams(key === 'remediation' ? { tab: 'remediation' } : {})} style={{ marginTop: 20 }} items={[
        ...(can('risks', 'read') ? [{ key: 'risks', label: '风险', children: <Table rowKey="id" dataSource={risks} onRow={(item) => ({ onClick: () => navigate(`/risks/${item.id}`), style: { cursor: 'pointer' } })} columns={[
          { title: '编号', dataIndex: 'code', width: 190 }, { title: '风险', dataIndex: 'title' },
          { title: '等级', dataIndex: 'riskLevel', width: 90, render: (value: string) => <Tag color={RISK_LEVEL[value]?.color}>{RISK_LEVEL[value]?.text || value}</Tag> },
          { title: '不符合项', width: 100, render: (_: any, item: any) => item.findingLinks?.length || 0 },
          { title: '状态', dataIndex: 'status', width: 130, render: (value: string) => <Tag>{riskStatus[value] || value}</Tag> },
          { title: '期限', dataIndex: 'dueDate', width: 120 },
        ]} /> }] : []),
        ...(can('remediation_actions', 'read') ? [{ key: 'remediation', label: '整改行动', children: <Table rowKey="id" dataSource={actions} onRow={(item) => ({ onClick: () => navigate(`/remediation-actions/${item.id}`), style: { cursor: 'pointer' } })} columns={[
          { title: '编号', dataIndex: 'code', width: 190 }, { title: '整改行动', dataIndex: 'title' },
          { title: '不符合项', width: 100, render: (_: any, item: any) => item.findingLinks?.length || 0 },
          { title: '风险', width: 80, render: (_: any, item: any) => item.riskLinks?.length || 0 },
          { title: '状态', dataIndex: 'status', width: 130, render: (value: string) => <Tag>{actionStatus[value] || value}</Tag> },
          { title: '期限', dataIndex: 'dueDate', width: 120 },
        ]} /> }] : []),
      ]} />
    </div>
  );
}
