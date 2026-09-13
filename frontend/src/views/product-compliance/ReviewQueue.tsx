import { useEffect, useState } from 'react';
import { Button, message, Table, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../utils/error';
import { StatusTag } from './labels';

export default function ReviewQueue() {
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const load = async (page = 1, pageSize = pagination.pageSize) => {
    setLoading(true);
    try { const response: any = await apiClient.get('/product-compliance/review-queue', { params: { page, pageSize } }); setItems(response.data?.items || []); setPagination({ current: response.data?.pagination?.page || page, pageSize, total: response.data?.pagination?.total || 0 }); }
    catch (error) { message.error(getApiErrorMessage(error, '加载待复核档案失败')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  return <div><Typography.Title level={3} style={{ marginBottom: 0 }}>待复核</Typography.Title><Typography.Paragraph type="secondary">复核产品负责人提交的合规档案，确认后形成不可变记录</Typography.Paragraph><Table rowKey="id" loading={loading} dataSource={items} pagination={pagination} onChange={(next) => load(next.current, next.pageSize)} columns={[
    { title: '产品', render: (_: any, row: any) => row.productVersion?.product?.name },
    { title: '版本', render: (_: any, row: any) => row.productVersion?.version, width: 120 },
    { title: '修订', dataIndex: 'revisionNumber', render: (value) => `R${value}`, width: 90 },
    { title: '状态', dataIndex: 'lifecycleStatus', render: (value) => <StatusTag value={value} />, width: 110 },
    { title: '拟定结论', dataIndex: 'proposedConclusion', render: (value) => <StatusTag conclusion value={value} />, width: 130 },
    { title: '提交时间', dataIndex: 'submittedAt', render: (value) => value ? new Date(value).toLocaleString('zh-CN') : '—', width: 190 },
    { title: '操作', render: (_: any, row: any) => <Button type="link" onClick={() => navigate(`/product-compliance/dossiers/${row.id}`)}>进入复核</Button>, width: 110 },
  ]} /></div>;
}
