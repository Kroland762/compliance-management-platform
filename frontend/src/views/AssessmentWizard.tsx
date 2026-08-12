import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, DatePicker, Form, Input, message, Select, Space, Steps, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../utils/error';

export default function AssessmentWizard() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [taskId, setTaskId] = useState<string>();
  const [templates, setTemplates] = useState<any[]>([]);
  const [template, setTemplate] = useState<any>();
  const [assets, setAssets] = useState<any[]>([]);
  const [assetSearching, setAssetSearching] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [departmentSearching, setDepartmentSearching] = useState(false);
  const [people, setPeople] = useState<any[]>([]);
  const [auditors, setAuditors] = useState<any[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [form] = Form.useForm();
  const assetSearchTimer = useRef<ReturnType<typeof setTimeout>>();
  const departmentSearchTimer = useRef<ReturnType<typeof setTimeout>>();
  const templateId = Form.useWatch('templateId', form);

  const mergeAssets = (incoming: any[]) => setAssets((existing) => {
    const selected = existing.filter((asset) => selectedAssetIds.includes(asset.id));
    const byId = new Map(incoming.map((asset) => [asset.id, asset]));
    selected.forEach((asset) => byId.set(asset.id, asset));
    return [...byId.values()];
  });

  const searchAssets = (keyword = '') => {
    clearTimeout(assetSearchTimer.current);
    assetSearchTimer.current = setTimeout(async () => {
      setAssetSearching(true);
      try {
        const response: any = await apiClient.get('/assets', { params: { pageSize: 100, status: 'active', keyword: keyword.trim() || undefined } });
        mergeAssets(response.data?.items || []);
      } finally { setAssetSearching(false); }
    }, keyword ? 250 : 0);
  };

  const searchDepartments = (keyword = '') => {
    clearTimeout(departmentSearchTimer.current);
    departmentSearchTimer.current = setTimeout(async () => {
      setDepartmentSearching(true);
      try {
        const response: any = await apiClient.get('/lookup/departments', { params: { q: keyword.trim() || undefined } });
        const selectedId = form.getFieldValue('departmentId');
        setDepartments((existing) => {
          const byId = new Map((response.data || []).map((department: any) => [department.id, department]));
          existing.filter((department) => department.id === selectedId).forEach((department) => byId.set(department.id, department));
          return [...byId.values()];
        });
      } finally { setDepartmentSearching(false); }
    }, keyword ? 250 : 0);
  };

  useEffect(() => {
    Promise.all([
      apiClient.get('/templates', { params: { pageSize: 100 } }),
      apiClient.get('/assets', { params: { pageSize: 100, status: 'active' } }),
      apiClient.get('/lookup/departments'),
      apiClient.get('/lookup/personnel'),
      apiClient.get('/lookup/auditors'),
    ]).then(([templateResponse, assetResponse, departmentResponse, peopleResponse, auditorResponse]: any[]) => {
      setTemplates(templateResponse.data?.items || []);
      setAssets(assetResponse.data?.items || []);
      setDepartments(departmentResponse.data || []);
      setPeople(peopleResponse.data || []);
      setAuditors(auditorResponse.data || []);
    });
    return () => { clearTimeout(assetSearchTimer.current); clearTimeout(departmentSearchTimer.current); };
  }, []);

  useEffect(() => {
    if (templateId) apiClient.get(`/templates/${templateId}`).then((response: any) => setTemplate(response.data));
  }, [templateId]);

  const selectedAssets = useMemo(() => assets.filter((asset) => selectedAssetIds.includes(asset.id)), [assets, selectedAssetIds]);

  const createDraft = async () => {
    const values = await form.validateFields(['templateId', 'name', 'departmentId', 'defaultAssigneeId', 'period', 'auditorUserIds']);
    const chosen = templates.find((item) => item.id === values.templateId);
    const response: any = await apiClient.post('/tasks', {
      templateId: values.templateId,
      name: values.name,
      assessmentTarget: values.name,
      assessmentType: chosen?.name || '标准评估',
      departmentId: values.departmentId,
      assignedTo: values.defaultAssigneeId,
      periodStart: values.period?.[0]?.format('YYYY-MM-DD'),
      periodEnd: values.period?.[1]?.format('YYYY-MM-DD'),
    });
    setTaskId(response.data.id);
    await apiClient.put(`/tasks/${response.data.id}/auditors`, { auditorUserIds: values.auditorUserIds });
    return response.data.id as string;
  };

  const next = async () => {
    setLoading(true);
    try {
      if (current === 0) await form.validateFields(['templateId']);
      if (current === 1 && !taskId) await createDraft();
      if (current === 2) {
        if (!selectedAssetIds.length) throw new Error('至少选择一个资产');
        await apiClient.put(`/tasks/${taskId}/assets`, { assetIds: selectedAssetIds });
      }
      setCurrent((value) => value + 1);
    } catch (error) {
      message.error(getApiErrorMessage(error, error instanceof Error ? error.message : '保存失败'));
    } finally { setLoading(false); }
  };

  const publish = async () => {
    setLoading(true);
    try {
      await apiClient.post(`/tasks/${taskId}/publish`);
      message.success(`评估已发布，共生成 ${template?.templateQuestions?.length || 0} 个评估行`);
      navigate(`/assessments/${taskId}`);
    } catch (error) { message.error(getApiErrorMessage(error, '发布失败')); }
    finally { setLoading(false); }
  };

  const stepContent = [
    <Form.Item key="template" name="templateId" label="标准版本" rules={[{ required: true, message: '请选择标准' }]}>
      <Select size="large" placeholder="选择要逐项评估的合规标准" options={templates.map((item) => ({ value: item.id, label: `${item.name}（${item.version || '1.0'}，${item.questionCount} 个控制项）` }))} />
    </Form.Item>,
    <Space key="basic" direction="vertical" style={{ width: '100%' }} size={0}>
      <Form.Item name="name" label="评估名称" rules={[{ required: true }]}><Input size="large" /></Form.Item>
      <Form.Item name="departmentId" label="归属部门" rules={[{ required: true }]}>
        <Select size="large" showSearch filterOption={false} onSearch={searchDepartments} onDropdownVisibleChange={(open) => open && searchDepartments()}
          loading={departmentSearching} placeholder="按部门名称搜索" options={departments.map((item) => ({ value: item.id, label: item.name }))} />
      </Form.Item>
      <Form.Item name="defaultAssigneeId" label="默认责任人" rules={[{ required: true, message: '请选择默认责任人' }]}
        extra="自动带入所有评估行；发布后可在评估表中按资产拆分行">
        <Select size="large" showSearch optionFilterProp="label" placeholder="选择默认填写责任人"
          options={people.map((item) => ({ value: item.userId, label: item.displayName || item.username }))} />
      </Form.Item>
      <Form.Item name="period" label="评估周期"><DatePicker.RangePicker style={{ width: '100%' }} /></Form.Item>
      <Form.Item name="auditorUserIds" label="审计员池" rules={[{ required: true, type: 'array', min: 1, message: '至少选择一名审计员' }]}>
        <Select mode="multiple" showSearch optionFilterProp="label" size="large" placeholder="选择可认领复核的审计员"
          options={auditors.map((item) => ({ value: item.userId, label: item.displayName || item.username }))} />
      </Form.Item>
    </Space>,
    <Select key="assets" mode="multiple" showSearch size="large" style={{ width: '100%' }} value={selectedAssetIds}
      onChange={setSelectedAssetIds} onSearch={searchAssets} filterOption={false} loading={assetSearching}
      placeholder="选择本次评估涉及的资产" options={assets.map((asset) => ({ value: asset.id, label: `${asset.code} · ${asset.name}` }))} />,
    <Alert key="preview" type="info" showIcon message="发布预览"
      description={`将生成 ${template?.templateQuestions?.length || 0} 个评估行，每行默认关联所选 ${selectedAssets.length} 个资产。评估表采用模板管理员保存的列顺序，回答与证据按行填写。`} />,
  ][current];

  return <div>
    <Typography.Title level={3}>创建评估项目</Typography.Title>
    <Card>
      <Steps current={current} items={['标准版本', '基本信息', '资产范围', '发布预览'].map((title) => ({ title }))} style={{ marginBottom: 32 }} />
      <Form form={form} layout="vertical" style={{ minHeight: 260 }}>{stepContent}</Form>
      <Space style={{ width: '100%', justifyContent: 'flex-end', marginTop: 24 }}>
        {current > 0 && <Button onClick={() => setCurrent((value) => value - 1)}>上一步</Button>}
        {current < 3 ? <Button type="primary" loading={loading} onClick={next}>下一步</Button> : <Button type="primary" loading={loading} onClick={publish}>发布评估</Button>}
      </Space>
    </Card>
  </div>;
}
