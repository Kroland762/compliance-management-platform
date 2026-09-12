import { useEffect, useState } from 'react';
import { Button, Checkbox, Form, Input, message, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import apiClient from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { getApiErrorMessage } from '../../utils/error';
import { LookupSelect } from '../../components/lookups';

const questionTypes = [
  ['boolean', '是/否'], ['single_select', '单选'], ['multi_select', '多选'], ['short_text', '短文本'],
  ['long_text', '长文本'], ['number', '数字'], ['date', '日期'],
].map(([value, label]) => ({ value, label }));

export default function Configuration() {
  const can = useAuthStore((state) => state.hasPermission);
  const [types, setTypes] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [typeOpen, setTypeOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [typeForm] = Form.useForm();
  const [templateForm] = Form.useForm();
  const [ruleForm] = Form.useForm();
  const load = async () => {
    try { const [typeRes, templateRes, ruleRes]: any[] = await Promise.all([apiClient.get('/product-compliance/config/product-types', { params: { includeRetired: true } }), apiClient.get('/product-compliance/config/questionnaires', { params: { includeRetired: true } }), apiClient.get('/product-compliance/config/rules')]); setTypes(typeRes.data || []); setTemplates(templateRes.data || []); setRules(ruleRes.data || []); }
    catch (error) { message.error(getApiErrorMessage(error, '加载配置失败')); }
  };
  useEffect(() => { load(); }, []);
  const createType = async (values: any) => { try { await apiClient.post('/product-compliance/config/product-types', values); message.success('产品类型已创建'); setTypeOpen(false); typeForm.resetFields(); load(); } catch (error) { message.error(getApiErrorMessage(error, '创建失败')); } };
  const retireType = async (id: string) => { try { await apiClient.post(`/product-compliance/config/product-types/${id}/retire`); message.success('产品类型已停用'); load(); } catch (error) { message.error(getApiErrorMessage(error, '停用失败')); } };
  const createTemplate = async (values: any) => {
    try {
      const questions = (values.questions || []).map((item: any) => ({ ...item, options: item.optionsText ? item.optionsText.split('\n').map((value: string) => value.trim()).filter(Boolean) : [] }));
      await apiClient.post('/product-compliance/config/questionnaires', { ...values, questions }); message.success('问卷模板已创建'); setTemplateOpen(false); templateForm.resetFields(); load();
    } catch (error) { message.error(getApiErrorMessage(error, '创建问卷失败')); }
  };
  const retireTemplate = async (id: string) => { try { await apiClient.post(`/product-compliance/config/questionnaires/${id}/retire`); message.success('问卷已停用'); load(); } catch (error) { message.error(getApiErrorMessage(error, '停用失败')); } };
  const openRules = (productTypeId: string) => { const selected = rules.filter((rule) => rule.productTypeId === productTypeId && rule.active).map((rule) => rule.templateId); ruleForm.setFieldsValue({ productTypeId, templateIds: selected }); setRuleOpen(true); };
  const saveRules = async (values: any) => { try { await apiClient.put(`/product-compliance/config/product-types/${values.productTypeId}/rules`, { rules: (values.templateIds || []).map((templateId: string) => ({ templateId, required: true })) }); message.success('适用规则已保存'); setRuleOpen(false); load(); } catch (error) { message.error(getApiErrorMessage(error, '保存规则失败')); } };

  const typeTab = <><Space style={{ width: '100%', justifyContent: 'flex-end', marginBottom: 12 }}>{can('product_compliance_config', 'create') ? <Button type="primary" icon={<PlusOutlined />} onClick={() => setTypeOpen(true)}>新增产品类型</Button> : null}</Space><Table rowKey="id" pagination={false} dataSource={types} columns={[
    { title: '编码', dataIndex: 'code', width: 180 }, { title: '名称', dataIndex: 'name' }, { title: '说明', dataIndex: 'description' },
    { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'active' ? 'green' : 'default'}>{value === 'active' ? '启用' : '停用'}</Tag>, width: 100 },
    { title: '适用问卷', render: (_: any, row: any) => rules.filter((rule) => rule.productTypeId === row.id && rule.active).length, width: 100 },
    { title: '操作', render: (_: any, row: any) => <Space>{can('product_compliance_config', 'update') ? <Button type="link" onClick={() => openRules(row.id)}>配置问卷</Button> : null}{row.status === 'active' && can('product_compliance_config', 'retire') ? <Popconfirm title="停用后不能用于新产品版本，确认？" onConfirm={() => retireType(row.id)}><Button danger type="link">停用</Button></Popconfirm> : null}</Space>, width: 180 },
  ]} /></>;
  const templateTab = <><Space style={{ width: '100%', justifyContent: 'flex-end', marginBottom: 12 }}>{can('product_compliance_config', 'create') ? <Button type="primary" icon={<PlusOutlined />} onClick={() => { templateForm.setFieldsValue({ status: 'draft', questions: [{}] }); setTemplateOpen(true); }}>新建问卷版本</Button> : null}</Space><Table rowKey="id" pagination={false} dataSource={templates} columns={[
    { title: '系列标识', dataIndex: 'seriesKey', width: 160 }, { title: '问卷名称', dataIndex: 'name' }, { title: '版本', dataIndex: 'version', width: 100 }, { title: '题目数', render: (_: any, row: any) => row.questions?.length || 0, width: 100 },
    { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'active' ? 'green' : value === 'draft' ? 'blue' : 'default'}>{value === 'active' ? '启用' : value === 'draft' ? '草稿' : '停用'}</Tag>, width: 100 },
    { title: '操作', render: (_: any, row: any) => row.status !== 'retired' && can('product_compliance_config', 'retire') ? <Popconfirm title="停用后不再匹配到新档案，确认？" onConfirm={() => retireTemplate(row.id)}><Button danger type="link">停用</Button></Popconfirm> : null, width: 100 },
  ]} /></>;
  return <div><Typography.Title level={3} style={{ marginBottom: 0 }}>配置管理</Typography.Title><Typography.Paragraph type="secondary">维护产品类型、版本化问卷及自动适用规则</Typography.Paragraph><Tabs items={[{ key: 'types', label: '产品类型与规则', children: typeTab }, { key: 'questionnaires', label: '问卷模板版本', children: templateTab }]} />
    <Modal title="新增产品类型" open={typeOpen} onCancel={() => setTypeOpen(false)} onOk={() => typeForm.submit()}><Form form={typeForm} layout="vertical" onFinish={createType}><Form.Item name="code" label="类型编码" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="name" label="类型名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="description" label="说明"><Input.TextArea /></Form.Item></Form></Modal>
    <Modal width={760} title="新建问卷模板版本" open={templateOpen} onCancel={() => setTemplateOpen(false)} onOk={() => templateForm.submit()} okText="创建"><Form form={templateForm} layout="vertical" onFinish={createTemplate}><Space align="start" style={{ width: '100%' }}><Form.Item name="seriesKey" label="问卷系列标识" rules={[{ required: true }]}><Input placeholder="privacy-baseline" /></Form.Item><Form.Item name="name" label="问卷名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="version" label="版本" rules={[{ required: true }]}><Input placeholder="1.0" /></Form.Item><Form.Item name="status" label="初始状态"><Select style={{ width: 110 }} options={[{ value: 'draft', label: '草稿' }, { value: 'active', label: '直接启用' }]} /></Form.Item></Space><Form.Item name="description" label="说明"><Input.TextArea /></Form.Item><Typography.Text strong>问题</Typography.Text><Form.List name="questions">{(fields, { add, remove }) => <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>{fields.map((field, index) => <Space key={field.key} align="start" wrap><Form.Item {...field} name={[field.name, 'stableKey']} rules={[{ required: true }]}><Input placeholder="稳定题目标识" /></Form.Item><Form.Item {...field} name={[field.name, 'title']} rules={[{ required: true }]}><Input placeholder={`问题 ${index + 1}`} style={{ width: 220 }} /></Form.Item><Form.Item {...field} name={[field.name, 'questionType']} rules={[{ required: true }]}><Select placeholder="类型" style={{ width: 120 }} options={questionTypes} /></Form.Item><Form.Item {...field} name={[field.name, 'required']} valuePropName="checked"><Checkbox>必填</Checkbox></Form.Item><Form.Item {...field} name={[field.name, 'optionsText']}><Input.TextArea placeholder="选择项，每行一个" rows={2} /></Form.Item><Button danger type="text" onClick={() => remove(field.name)}>删除</Button></Space>)}<Button block onClick={() => add({})}>添加问题</Button></Space>}</Form.List></Form></Modal>
    <Modal title="配置适用问卷" open={ruleOpen} onCancel={() => setRuleOpen(false)} onOk={() => ruleForm.submit()}><Form form={ruleForm} layout="vertical" onFinish={saveRules}><Form.Item name="productTypeId" hidden><Input /></Form.Item><Form.Item name="templateIds" label="自动匹配的启用问卷"><LookupSelect kind="product-questionnaires" purpose="product-questionnaire" mode="multiple" /></Form.Item></Form></Modal>
  </div>;
}
