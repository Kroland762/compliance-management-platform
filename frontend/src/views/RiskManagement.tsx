import { useState, useEffect } from 'react';
import { Table, Select, Tag, Typography, Button, Space, message, Modal, Form, Input, Popconfirm } from 'antd';
import { ExportOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../utils/error';

const { Title } = Typography;

const riskLevelColors: Record<string, string> = { high: 'red', medium: 'orange', low: 'green' };
const riskLevelLabels: Record<string, string> = { high: '高', medium: '中', low: '低' };

export default function RiskManagement() {
  const [risks, setRisks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form] = Form.useForm();
  const [filters, setFilters] = useState({ riskLevel: '', remediationStatus: '', riskStatus: '' });

  const fetchRisks = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.riskLevel) params.set('riskLevel', filters.riskLevel);
    if (filters.remediationStatus) params.set('remediationStatus', filters.remediationStatus);
    if (filters.riskStatus) params.set('riskStatus', filters.riskStatus);
    const qs = params.toString();
    apiClient.get(`/risks${qs ? '?' + qs : ''}`).then((res: any) => {
      setRisks(res.data?.items || []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchRisks(); }, [filters]);

  const handleCreate = async (values: any) => {
    setCreateLoading(true);
    try {
      await apiClient.post('/risks', values);
      message.success('风险记录已创建');
      setCreateVisible(false);
      form.resetFields();
      fetchRisks();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '创建失败'));
    } finally { setCreateLoading(false); }
  };

  const handleStatusUpdate = async (id: string, field: string, value: string) => {
    try {
      await apiClient.put(`/risks/${id}`, { [field]: value });
      message.success('已更新');
      fetchRisks();
    } catch { message.error('更新失败'); }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/risks/${id}`);
      message.success('风险记录已删除');
      fetchRisks();
    } catch (err: any) { message.error(getApiErrorMessage(err, '删除失败')); }
  };

  const handleExport = async () => {
    try {
      const res = await apiClient.get('/export/risks', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res as any]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'risk-summary.xlsx';
      a.click();
      message.success('导出成功');
    } catch { message.error('导出失败'); }
  };

  const columns = [
    { title: '序号', render: (_: any, __: any, i: number) => i + 1, width: 60 },
    { title: '评估方式', dataIndex: 'assessmentType' },
    { title: '评估对象', dataIndex: 'assessmentTarget' },
    { title: '风险识别', dataIndex: 'riskIdentification' },
    {
      title: '风险级别', dataIndex: 'riskLevel',
      render: (v: string, record: any) => (
        <Select size="small" style={{ width: 70 }} value={v} onChange={val => handleStatusUpdate(record.id, 'riskLevel', val)}
          options={[
            { value: 'high', label: '高' },
            { value: 'medium', label: '中' },
            { value: 'low', label: '低' },
          ]}
        />
      ),
      sorter: (a: any, b: any) => {
        const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
        return (order[a.riskLevel] ?? 9) - (order[b.riskLevel] ?? 9);
      },
    },
    { title: '补救措施', dataIndex: 'remediationMeasures' },
    {
      title: '补救状态', dataIndex: 'remediationStatus',
      render: (v: string, record: any) => (
        <Select size="small" style={{ width: 100 }} value={v} onChange={val => handleStatusUpdate(record.id, 'remediationStatus', val)}
          options={[
            { value: 'remediated', label: '已补救' },
            { value: 'in_progress', label: '补救中' },
            { value: 'not_remediated', label: '未补救' },
          ]}
        />
      ),
    },
    {
      title: '风险状态', dataIndex: 'riskStatus',
      render: (v: string, record: any) => (
        <Select size="small" style={{ width: 100 }} value={v} onChange={val => handleStatusUpdate(record.id, 'riskStatus', val)}
          options={[
            { value: 'risk_acceptance', label: '风险接受' },
            { value: 'risk_transfer', label: '风险转移' },
            { value: 'risk_reduction', label: '风险降低' },
            { value: 'risk_elimination', label: '风险规避' },
          ]}
        />
      ),
    },
    {
      title: '操作', width: 80,
      render: (_: any, record: any) => (
        <Popconfirm title="确定删除？" cancelText="取消" okText="确认" onConfirm={() => handleDelete(record.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={3} style={{ fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 24 }}>风险管理</Title>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateVisible(true)}>新增风险</Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>导出报告</Button>
        </Space>
      </div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 12 }}>
        <Select
          placeholder="风险级别"
          value={filters.riskLevel || undefined}
          onChange={v => setFilters(f => ({ ...f, riskLevel: v || '' }))}
          allowClear
          size="small"
          style={{ width: 110 }}
          options={[
            { value: 'high', label: '高风险' },
            { value: 'medium', label: '中风险' },
            { value: 'low', label: '低风险' },
          ]}
        />
        <Select
          placeholder="补救状态"
          value={filters.remediationStatus || undefined}
          onChange={v => setFilters(f => ({ ...f, remediationStatus: v || '' }))}
          allowClear
          size="small"
          style={{ width: 110 }}
          options={[
            { value: 'remediated', label: '已补救' },
            { value: 'in_progress', label: '补救中' },
            { value: 'not_remediated', label: '未补救' },
          ]}
        />
        <Select
          placeholder="风险状态"
          value={filters.riskStatus || undefined}
          onChange={v => setFilters(f => ({ ...f, riskStatus: v || '' }))}
          allowClear
          size="small"
          style={{ width: 120 }}
          options={[
            { value: 'risk_acceptance', label: '风险接受' },
            { value: 'risk_transfer', label: '风险转移' },
            { value: 'risk_reduction', label: '风险降低' },
            { value: 'risk_elimination', label: '风险规避' },
          ]}
        />
      </div>
      <Table columns={columns} dataSource={risks} rowKey="id" loading={loading} scroll={{ x: 1100 }} size="small" />

      <Modal title="新增风险记录" open={createVisible} onCancel={() => { setCreateVisible(false); form.resetFields(); }} footer={null}>
        <Form form={form} layout="vertical" onFinish={handleCreate} style={{ marginTop: 16 }}>
          <Form.Item name="assessmentType" label="评估方式" rules={[{ required: true, message: '请输入评估方式' }]}>
            <Input placeholder="例如：ISO 27001" />
          </Form.Item>
          <Form.Item name="assessmentTarget" label="评估对象" rules={[{ required: true, message: '请输入评估对象' }]}>
            <Input placeholder="例如：核心业务系统" />
          </Form.Item>
          <Form.Item name="riskIdentification" label="风险识别" rules={[{ required: true, message: '请输入风险描述' }]}>
            <Input.TextArea rows={2} placeholder="描述识别到的风险" />
          </Form.Item>
          <Form.Item name="riskLevel" label="风险级别" rules={[{ required: true, message: '请选择风险级别' }]}>
            <Select options={[
              { value: 'high', label: '高' },
              { value: 'medium', label: '中' },
              { value: 'low', label: '低' },
            ]} />
          </Form.Item>
          <Form.Item name="remediationMeasures" label="补救措施">
            <Input.TextArea rows={2} placeholder="建议的补救措施" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createLoading} block style={{ borderRadius: 10, fontWeight: 500 }}>
            创建
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
