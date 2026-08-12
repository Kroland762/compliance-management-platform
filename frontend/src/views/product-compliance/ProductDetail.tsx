import { useEffect, useState } from 'react';
import { Alert, Button, Card, DatePicker, Descriptions, Form, Input, message, Modal, Select, Space, Steps, Table, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import apiClient from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { getApiErrorMessage } from '../../utils/error';
import { platformOptions, StatusTag } from './labels';

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const can = useAuthStore((state) => state.hasPermission);
  const [product, setProduct] = useState<any>();
  const [types, setTypes] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [form] = Form.useForm();
  const load = async () => {
    try { const response: any = await apiClient.get(`/product-compliance/products/${id}`); setProduct(response.data); }
    catch (error) { message.error(getApiErrorMessage(error, '加载产品详情失败')); }
  };
  useEffect(() => { load(); apiClient.get('/product-compliance/config/product-types').then((response: any) => setTypes(response.data || [])); }, [id]);

  const createVersion = async () => {
    try {
      const values = await form.validateFields();
      const payload = { ...values, plannedReleaseDate: values.plannedReleaseDate?.format('YYYY-MM-DD'), actualReleaseDate: values.actualReleaseDate?.format('YYYY-MM-DD'), changeDeclaration: { summary: values.changeSummary, complianceChanged: values.complianceChanged, details: values.changeDetails || null } };
      delete payload.changeSummary; delete payload.complianceChanged; delete payload.changeDetails;
      const response: any = await apiClient.post(`/product-compliance/products/${id}/versions`, payload);
      message.success(response.data?.inheritedFrom ? '新版本已创建，并继承上一版档案草稿' : '首个产品版本已创建');
      setOpen(false); setStep(0); form.resetFields(); load();
      navigate(`/product-compliance/dossiers/${response.data.dossier.id}`);
    } catch (error: any) { if (!error?.errorFields) message.error(getApiErrorMessage(error, '创建产品版本失败')); }
  };
  if (!product) return null;
  return <div>
    <Space style={{ marginBottom: 16 }}><Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/product-compliance/products')}>返回</Button></Space>
    <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
      <div><Typography.Title level={3} style={{ margin: 0 }}>{product.name}</Typography.Title><Typography.Text type="secondary">{product.code}</Typography.Text></div>
      {product.status === 'active' && can('products', 'update') ? <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.setFieldsValue({ productTypeId: product.defaultProductTypeId, complianceChanged: false }); setOpen(true); }}>创建产品版本</Button> : null}
    </Space>
    <Card style={{ marginBottom: 20 }}><Descriptions column={2} items={[
      { key: 'type', label: '默认产品类型', children: product.defaultProductType?.name },
      { key: 'status', label: '产品状态', children: <Tag color={product.status === 'active' ? 'green' : 'default'}>{product.status === 'active' ? '使用中' : '已归档'}</Tag> },
      { key: 'description', label: '产品说明', children: product.description || '—', span: 2 },
    ]} /></Card>
    <Typography.Title level={4}>版本时间线</Typography.Title>
    <Table rowKey="id" dataSource={product.versions || []} pagination={false} columns={[
      { title: '版本', dataIndex: 'version', width: 130 },
      { title: '适用平台', dataIndex: 'platforms', render: (values: string[]) => values?.map((value) => <Tag key={value}>{value}</Tag>) },
      { title: '产品类型', render: (_: any, row: any) => row.productType?.name || '—', width: 140 },
      { title: '计划上线', dataIndex: 'plannedReleaseDate', width: 120 },
      { title: '修订', render: (_: any, row: any) => row.dossiers?.length || 0, width: 80 },
      { title: '当前档案', render: (_: any, row: any) => { const dossier = [...(row.dossiers || [])].sort((a: any, b: any) => b.revisionNumber - a.revisionNumber)[0]; return dossier ? <Space><StatusTag value={dossier.lifecycleStatus} /><StatusTag conclusion value={dossier.complianceConclusion} /></Space> : '—'; } },
      { title: '操作', render: (_: any, row: any) => { const dossier = [...(row.dossiers || [])].sort((a: any, b: any) => b.revisionNumber - a.revisionNumber)[0]; return dossier ? <Button type="link" onClick={() => navigate(`/product-compliance/dossiers/${dossier.id}`)}>查看档案</Button> : null; }, width: 100 },
    ]} />
    <Modal width={680} title="创建产品版本" open={open} onCancel={() => { setOpen(false); setStep(0); }} footer={<Space><Button onClick={() => setOpen(false)}>取消</Button>{step > 0 ? <Button onClick={() => setStep(step - 1)}>上一步</Button> : null}{step < 2 ? <Button type="primary" onClick={() => form.validateFields(step === 0 ? ['version', 'productTypeId', 'platforms', 'usageScope'] : ['changeSummary', 'complianceChanged']).then(() => setStep(step + 1))}>下一步</Button> : <Button type="primary" onClick={createVersion}>创建并进入档案</Button>}</Space>} destroyOnHidden>
      <Steps current={step} size="small" items={[{ title: '版本信息' }, { title: '变更声明' }, { title: '继承确认' }]} style={{ marginBottom: 24 }} />
      <Form form={form} layout="vertical" preserve>
        <div style={{ display: step === 0 ? 'block' : 'none' }}>
          <Form.Item name="version" label="版本号" rules={[{ required: true }]}><Input placeholder="例如 2.3.0" /></Form.Item>
          <Form.Item name="productTypeId" label="本版本产品类型" rules={[{ required: true }]}><Select options={types.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
          <Form.Item name="platforms" label="适用平台" rules={[{ required: true }]}><Select mode="tags" options={platformOptions} placeholder="选择或输入平台" /></Form.Item>
          <Form.Item name="usageScope" label="使用范围" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
          <Space style={{ width: '100%' }} align="start"><Form.Item name="plannedReleaseDate" label="计划上线日期"><DatePicker /></Form.Item><Form.Item name="actualReleaseDate" label="实际上线日期"><DatePicker disabledDate={(date) => date && date.isAfter(dayjs())} /></Form.Item></Space>
        </div>
        <div style={{ display: step === 1 ? 'block' : 'none' }}>
          <Form.Item name="changeSummary" label="版本变更摘要" rules={[{ required: true }]}><Input.TextArea rows={3} placeholder="说明功能、权限、数据处理或部署范围变化" /></Form.Item>
          <Form.Item name="complianceChanged" label="是否预计影响合规状态" rules={[{ required: true }]}><Select options={[{ value: false, label: '未发现影响，仍需复核' }, { value: true, label: '可能影响，需要重新评估' }]} /></Form.Item>
          <Form.Item name="changeDetails" label="影响说明"><Input.TextArea rows={3} /></Form.Item>
        </div>
        {step === 2 ? <Alert type="info" showIcon message="系统将按当前产品类型规则重新匹配问卷" description="若存在上一版已确认档案，将复制权限、信息类型、ROPA，并按稳定题目标识继承答案。合规结论不会直接继承，新档案仍需重新提交复核。" /> : null}
      </Form>
    </Modal>
  </div>;
}
