import { useEffect, useState } from 'react';
import { Alert, Breadcrumb, Button, Card, DatePicker, Form, Input, message, Space, Steps, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../utils/error';
import { AuditorSelect, DepartmentSelect, LookupSelect, PersonnelSelect } from '../components/lookups';

export default function AssessmentWizard() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [taskId, setTaskId] = useState<string>();
  const [template, setTemplate] = useState<any>();
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [form] = Form.useForm();
  const templateId = Form.useWatch('templateId', form);

  useEffect(() => {
    if (!templateId) {
      setTemplate(undefined);
      return;
    }
    let active = true;
    apiClient.get(`/templates/${templateId}`)
      .then((response: any) => { if (active) setTemplate(response.data); })
      .catch((error) => { if (active) message.error(getApiErrorMessage(error, '标准详情加载失败')); });
    return () => { active = false; };
  }, [templateId]);

  const createDraft = async () => {
    const values = await form.validateFields(['templateId', 'name', 'departmentId', 'defaultAssigneeId', 'period', 'auditorUserIds']);
    const response: any = await apiClient.post('/tasks', {
      templateId: values.templateId,
      name: values.name,
      assessmentTarget: values.name,
      assessmentType: template?.name || '标准评估',
      departmentId: values.departmentId,
      assignedTo: values.defaultAssigneeId,
      periodStart: values.period?.[0]?.format('YYYY-MM-DD'),
      periodEnd: values.period?.[1]?.format('YYYY-MM-DD'),
    });
    setTaskId(response.data.id);
    await apiClient.put(`/tasks/${response.data.id}/auditors`, { auditorUserIds: values.auditorUserIds });
    message.success('评估项目草稿已保存');
    return response.data.id as string;
  };

  const exit = () => {
    if (taskId) message.info('草稿已保存，已返回项目列表');
    navigate('/assessments');
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
      <LookupSelect kind="assessment-templates" purpose="assessment-owner" size="large" placeholder="输入标准名称检索" />
    </Form.Item>,
    <Space key="basic" direction="vertical" style={{ width: '100%' }} size={0}>
      <Form.Item name="name" label="评估名称" rules={[{ required: true }]}><Input size="large" /></Form.Item>
      <Form.Item name="departmentId" label="归属部门" rules={[{ required: true }]}>
        <DepartmentSelect purpose="assessment-owner" size="large" />
      </Form.Item>
      <Form.Item name="defaultAssigneeId" label="默认责任人" rules={[{ required: true, message: '请选择默认责任人' }]}
        extra="自动带入所有评估行；发布后可在评估表中按资产拆分行">
        <PersonnelSelect purpose="assessment-owner" size="large" placeholder="输入默认责任人姓名" />
      </Form.Item>
      <Form.Item name="period" label="评估周期"><DatePicker.RangePicker style={{ width: '100%' }} /></Form.Item>
      <Form.Item name="auditorUserIds" label="审计员池" rules={[{ required: true, type: 'array', min: 1, message: '至少选择一名审计员' }]}>
        <AuditorSelect mode="multiple" size="large" />
      </Form.Item>
    </Space>,
    <LookupSelect key="assets" kind="assets" purpose="evaluation-assignment" mode="multiple" size="large" style={{ width: '100%' }} value={selectedAssetIds}
      onChange={setSelectedAssetIds} placeholder="输入资产名称检索" />,
    <Alert key="preview" type="info" showIcon message="发布预览"
      description={`将生成 ${template?.templateQuestions?.length || 0} 个评估行，每行默认关联所选 ${selectedAssetIds.length} 个资产。评估表采用模板管理员保存的列顺序，回答与证据按行填写。`} />,
  ][current];

  return <div>
    <Breadcrumb style={{ marginBottom: 16 }} items={[
      { title: <Button type="link" onClick={exit} style={{ padding: 0 }}>评估项目</Button> },
      { title: '创建评估项目' },
    ]} />
    <Typography.Title level={3} style={{ marginTop: 0 }}>创建评估项目</Typography.Title>
    <Card>
      {taskId && (
        <Alert
          type="success"
          showIcon
          message="评估项目草稿已保存"
          description="你可以继续配置资产范围并发布，也可以返回项目列表。"
          action={<Button size="small" onClick={exit}>返回项目列表</Button>}
          style={{ marginBottom: 24 }}
        />
      )}
      <Steps current={current} items={['标准版本', '基本信息', '资产范围', '发布预览'].map((title) => ({ title }))} style={{ marginBottom: 32 }} />
      <Form form={form} layout="vertical" style={{ minHeight: 260 }}>{stepContent}</Form>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginTop: 24 }}>
        <Button onClick={exit}>{taskId ? '保存草稿并退出' : '取消创建'}</Button>
        <Space>
          {current > 0 && <Button onClick={() => setCurrent((value) => value - 1)}>上一步</Button>}
          {current < 3 ? <Button type="primary" loading={loading} onClick={next}>下一步</Button> : <Button type="primary" loading={loading} onClick={publish}>发布评估</Button>}
        </Space>
      </Space>
    </Card>
  </div>;
}
