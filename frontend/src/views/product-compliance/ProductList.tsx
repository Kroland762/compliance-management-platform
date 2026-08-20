import { useEffect, useState } from 'react';
import { Button, Form, Input, message, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { EyeOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { getApiErrorMessage } from '../../utils/error';
import { StatusTag } from './labels';
import { DepartmentSelect, LookupSelect, PersonnelSelect } from '../../components/lookups';

export default function ProductList() {
  const navigate = useNavigate();
  const can = useAuthStore((state) => state.hasPermission);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<any>({ status: 'active' });
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [form] = Form.useForm();

  const load = async (page = 1, pageSize = pagination.pageSize, nextFilters = filters) => {
    setLoading(true);
    try {
      const response: any = await apiClient.get('/product-compliance/products', { params: { page, pageSize, ...nextFilters } });
      setItems(response.data?.items || []);
      setPagination({ current: response.data?.pagination?.page || page, pageSize, total: response.data?.pagination?.total || 0 });
    } catch (error) { message.error(getApiErrorMessage(error, '加载产品失败')); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
  }, []);
  const submit = async (values: any) => {
    try {
      await apiClient.post('/product-compliance/products', values);
      message.success('产品已创建'); setOpen(false); form.resetFields(); load(1);
    } catch (error) { message.error(getApiErrorMessage(error, '创建产品失败')); }
  };
  const archive = async (id: string) => {
    try { await apiClient.post(`/product-compliance/products/${id}/archive`); message.success('产品已归档'); load(pagination.current); }
    catch (error) { message.error(getApiErrorMessage(error, '归档产品失败')); }
  };
  const applyFilters = (patch: any) => { const next = { ...filters, ...patch }; setFilters(next); load(1, pagination.pageSize, next); };

  return <div>
    <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 20 }}>
      <div><Typography.Title level={3} style={{ margin: 0 }}>产品台账</Typography.Title><Typography.Text type="secondary">按产品版本维护可追溯的合规档案</Typography.Text></div>
      {can('products', 'create') ? <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新增产品</Button> : null}
    </Space>
    <Space wrap style={{ marginBottom: 16 }}>
      <Input.Search allowClear placeholder="产品名称或编码" style={{ width: 240 }} onSearch={(keyword) => applyFilters({ keyword: keyword || undefined })} />
      <LookupSelect kind="product-types" purpose="product-filter" allowClear placeholder="输入产品类型名称" style={{ width: 180 }} onChange={(productTypeId) => applyFilters({ productTypeId })} />
      <Select value={filters.status} style={{ width: 130 }} options={[{ value: 'active', label: '使用中' }, { value: 'archived', label: '已归档' }]} onChange={(status) => applyFilters({ status })} />
      <Select allowClear placeholder="档案状态" style={{ width: 140 }} options={Object.entries({ draft: '草稿', pending_review: '待复核', changes_requested: '已退回', confirmed: '已确认' }).map(([value, label]) => ({ value, label }))} onChange={(dossierStatus) => applyFilters({ dossierStatus })} />
      <Select allowClear placeholder="合规结论" style={{ width: 150 }} options={Object.entries({ not_assessed: '未评估', compliant: '符合', conditionally_compliant: '有条件符合', non_compliant: '不符合' }).map(([value, label]) => ({ value, label }))} onChange={(complianceConclusion) => applyFilters({ complianceConclusion })} />
    </Space>
    <Table rowKey="id" loading={loading} dataSource={items} pagination={pagination} onChange={(next) => load(next.current, next.pageSize)} columns={[
      { title: '产品编码', dataIndex: 'code', width: 150 },
      { title: '产品名称', dataIndex: 'name' },
      { title: '产品类型', render: (_: any, row: any) => row.defaultProductType?.name || '—', width: 150 },
      { title: '最新版本', render: (_: any, row: any) => row.versions?.[0]?.version || '尚未建档', width: 120 },
      { title: '档案状态', render: (_: any, row: any) => <StatusTag value={row.versions?.[0]?.dossiers?.[0]?.lifecycleStatus} />, width: 110 },
      { title: '合规结论', render: (_: any, row: any) => <StatusTag conclusion value={row.versions?.[0]?.dossiers?.[0]?.complianceConclusion} />, width: 120 },
      { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'active' ? 'green' : 'default'}>{value === 'active' ? '使用中' : '已归档'}</Tag>, width: 100 },
      { title: '操作', width: 160, render: (_: any, row: any) => <Space size={0}><Button type="link" icon={<EyeOutlined />} onClick={() => navigate(`/product-compliance/products/${row.id}`)}>查看</Button>{row.status === 'active' && can('products', 'archive') ? <Popconfirm title="归档后不能创建新版本，确认归档？" onConfirm={() => archive(row.id)}><Button type="link" icon={<StopOutlined />}>归档</Button></Popconfirm> : null}</Space> },
    ]} />
    <Modal title="新增产品" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="创建" destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={submit} preserve={false}>
        <Form.Item name="code" label="产品编码" rules={[{ required: true }, { pattern: /^[A-Z0-9][A-Z0-9_-]*$/, message: '仅支持大写字母、数字、下划线和连字符' }]}><Input placeholder="例如 MOBILE_APP" /></Form.Item>
        <Form.Item name="name" label="产品名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="defaultProductTypeId" label="默认产品类型" rules={[{ required: true }]}><LookupSelect kind="product-types" purpose="product-owner" /></Form.Item>
        <Form.Item name="ownerDepartmentId" label="归属部门" rules={[{ required: true }]}><DepartmentSelect purpose="product-owner" /></Form.Item>
        <Form.Item name="ownerUserId" label="产品负责人" rules={[{ required: true }]}><PersonnelSelect purpose="product-owner" /></Form.Item>
        <Form.Item name="description" label="产品说明"><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
