import { useState, useEffect } from 'react';
import { Table, Typography, Tag } from 'antd';
import apiClient from '../../api/client';

const { Title } = Typography;

export default function AuditLogViewer() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiClient.get('/audit-logs').then((res: any) => {
      setLogs(res.data?.items || []);
    }).finally(() => setLoading(false));
  }, []);

  const columns = [
    { title: '时间', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleString() },
    { title: '用户', dataIndex: 'user', render: (u: any) => u?.username || '-' },
    { title: '操作类型', dataIndex: 'operationType', render: (v: string) => <Tag>{v}</Tag> },
    { title: '资源类型', dataIndex: 'resourceType' },
    { title: '详情', dataIndex: 'operationDetails' },
    { title: '结果', dataIndex: 'success', render: (v: boolean) => v ? <Tag color="green">成功</Tag> : <Tag color="red">失败</Tag> },
  ];

  return (
    <div>
      <Title level={3} style={{ fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 24 }}>审计日志</Title>
      <Table columns={columns} dataSource={logs} rowKey="id" loading={loading} />
    </div>
  );
}
