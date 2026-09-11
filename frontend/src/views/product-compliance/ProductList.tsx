import { useEffect, useState } from 'react';
import { Button, ConfigProvider, Empty, Form, Input, message, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { ClearOutlined, EyeOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { getApiErrorMessage } from '../../utils/error';
import { StatusTag } from './labels';
import { DepartmentSelect, LookupSelect, PersonnelSelect } from '../../components/lookups';

const accessibleTextTheme = { token: { colorTextSecondary: '#636366', colorTextTertiary: '#636366', colorTextDescription: '#636366', colorTextPlaceholder: '#636366' } };

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
  useEffect(() => {
    if (open) form.resetFields();
  }, [form, open]);
  const submit = async (values: any) => {
    try {
      const response: any = await apiClient.post('/product-compliance/products', values);
      message.success('产品已创建，请创建首个版本'); setOpen(false); form.resetFields();
      if (response.data?.id) navigate(`/product-compliance/products/${response.data.id}`);
      else load(1);
    } catch (error) { message.error(getApiErrorMessage(error, '创建产品失败')); }
  };
  const archive = async (id: string) => {
    try { await apiClient.post(`/product-compliance/products/${id}/archive`); message.success('产品已归档'); load(pagination.current); }
    catch (error) { message.error(getApiErrorMessage(error, '归档产品失败')); }
  };
  const applyFilters = (patch: any) => { const next = { ...filters, ...patch }; setFilters(next); load(1, pagination.pageSize, next); };
  const clearFilters = () => { setFilters({}); load(1, pagination.pageSize, {}); };
  const statusLabels: Record<string, string> = { active: '使用中', archived: '已归档' };
  const dossierStatusLabels: Record<string, string> = { draft: '草稿', pending_review: '待复核', changes_requested: '已退回', confirmed: '已确认' };
  const conclusionFilterLabels: Record<string, string> = { not_assessed: '未评估', compliant: '符合', conditionally_compliant: '有条件符合', non_compliant: '不符合' };
  const activeFilters = [
    filters.keyword ? { key: 'keyword', label: `关键词：${filters.keyword}` } : null,
    filters.productTypeId ? { key: 'productTypeId', label: '产品类型：已选择' } : null,
    filters.status ? { key: 'status', label: `产品状态：${statusLabels[filters.status]}` } : null,
    filters.dossierStatus ? { key: 'dossierStatus', label: `档案状态：${dossierStatusLabels[filters.dossierStatus]}` } : null,
    filters.complianceConclusion ? { key: 'complianceConclusion', label: `合规结论：${conclusionFilterLabels[filters.complianceConclusion]}` } : null,
  ].filter(Boolean) as Array<{ key: string; label: string }>;
  const removeFilter = (key: string) => applyFilters({ [key]: undefined });
  const openCreateModal = () => setOpen(true);
  const emptyText = <Empty
    image={Empty.PRESENTED_IMAGE_SIMPLE}
    description={activeFilters.length > 1 || !filters.status
      ? '没有符合当前筛选条件的产品'
      : '暂无使用中的产品。先创建产品，再创建版本和合规档案。'}
  >
    {activeFilters.length > 1 || !filters.status
      ? <Button icon={<ClearOutlined />} onClick={clearFilters}>清除全部筛选</Button>
      : can('products', 'create') ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>创建首个产品</Button> : null}
  </Empty>;

  return <ConfigProvider theme={accessibleTextTheme}><div>
    <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 20 }}>
      <div><Typography.Title level={3} style={{ margin: 0 }}>产品台账</Typography.Title><Typography.Text type="secondary">按产品版本维护可追溯的合规档案</Typography.Text></div>
      {can('products', 'create') ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>新增产品</Button> : null}
    </Space>
    <Space wrap style={{ marginBottom: 16 }}>
      <Input.Search value={filters.keyword || ''} allowClear placeholder="产品名称或编码" style={{ width: 240 }} onChange={(event) => setFilters((current: any) => ({ ...current, keyword: event.target.value || undefined }))} onSearch={(keyword) => applyFilters({ keyword: keyword || undefined })} />
      <LookupSelect value={filters.productTypeId} kind="product-types" purpose="product-filter" allowClear placeholder="输入产品类型名称" style={{ width: 180 }} onChange={(productTypeId) => applyFilters({ productTypeId })} />
      <Select value={filters.status} allowClear placeholder="产品状态" style={{ width: 130 }} options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} onChange={(status) => applyFilters({ status })} />
      <Select value={filters.dossierStatus} allowClear placeholder="档案状态" style={{ width: 140 }} options={Object.entries(dossierStatusLabels).map(([value, label]) => ({ value, label }))} onChange={(dossierStatus) => applyFilters({ dossierStatus })} />
      <Select value={filters.complianceConclusion} allowClear placeholder="合规结论" style={{ width: 150 }} options={Object.entries(conclusionFilterLabels).map(([value, label]) => ({ value, label }))} onChange={(complianceConclusion) => applyFilters({ complianceConclusion })} />
    </Space>
    <Space wrap size={[8, 8]} style={{ width: '100%', marginBottom: 16 }}>
      <Typography.Text type="secondary">共 {pagination.total} 个产品</Typography.Text>
      {activeFilters.map((filter) => <Tag key={filter.key} closable onClose={(event) => { event.preventDefault(); removeFilter(filter.key); }}>{filter.label}</Tag>)}
      {activeFilters.length ? <Button type="link" size="small" icon={<ClearOutlined />} onClick={clearFilters}>清除全部</Button> : null}
    </Space>
    <Table rowKey="id" loading={loading} dataSource={items} locale={{ emptyText }} pagination={pagination} onChange={(next) => load(next.current, next.pageSize)} columns={[
      { title: '产品编码', dataIndex: 'code', width: 150 },
      { title: '产品名称', dataIndex: 'name' },
      { title: '产品类型', render: (_: any, row: any) => row.defaultProductType?.name || '—', width: 150 },
      { title: '最新版本', render: (_: any, row: any) => row.versions?.[0]?.version || '尚未建档', width: 120 },
      { title: '档案状态', render: (_: any, row: any) => <StatusTag value={row.versions?.[0]?.dossiers?.[0]?.lifecycleStatus} />, width: 110 },
      { title: '合规结论', render: (_: any, row: any) => <StatusTag conclusion value={row.versions?.[0]?.dossiers?.[0]?.complianceConclusion} />, width: 120 },
      { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'active' ? 'green' : 'default'}>{value === 'active' ? '使用中' : '已归档'}</Tag>, width: 100 },
      { title: '操作', width: 160, render: (_: any, row: any) => <Space size={0}><Button type="link" icon={<EyeOutlined />} onClick={() => navigate(`/product-compliance/products/${row.id}`)}>查看</Button>{row.status === 'active' && can('products', 'archive') ? <Popconfirm title="归档后不能创建新版本，确认归档？" onConfirm={() => archive(row.id)}><Button type="link" icon={<StopOutlined />}>归档</Button></Popconfirm> : null}</Space> },
    ]} />
    <Modal title="新增产品" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="创建" cancelText="取消" destroyOnHidden styles={{ body: { maxHeight: 'calc(100vh - 260px)', overflowY: 'auto', paddingRight: 8 } }}>
      <Form form={form} layout="vertical" onFinish={submit} preserve={false}>
        <Form.Item name="code" label="产品编码" rules={[{ required: true }, { pattern: /^[A-Z0-9][A-Z0-9_-]*$/, message: '仅支持大写字母、数字、下划线和连字符' }]}><Input placeholder="例如 MOBILE_APP" /></Form.Item>
        <Form.Item name="name" label="产品名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="defaultProductTypeId" label="默认产品类型" rules={[{ required: true }]}><LookupSelect kind="product-types" purpose="product-owner" /></Form.Item>
        <Form.Item name="ownerDepartmentId" label="归属部门" rules={[{ required: true }]}><DepartmentSelect purpose="product-owner" /></Form.Item>
        <Form.Item name="ownerUserId" label="产品负责人" rules={[{ required: true }]}><PersonnelSelect purpose="product-owner" /></Form.Item>
        <Form.Item name="description" label="产品说明"><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>
  </div></ConfigProvider>;
}
