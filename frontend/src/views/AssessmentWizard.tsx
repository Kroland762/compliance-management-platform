import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, DatePicker, Form, Input, message, Select, Space, Steps, Table, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../utils/error';
import { buildControlAssetMatrix } from '../utils/relationship';

interface MatrixRow {
  key: string;
  controlPointId: string;
  assetId: string;
  sequenceNumber: string;
  controlPoint: string;
  assetName: string;
  assignedTo?: string;
  responsibleDepartmentId?: string;
}

export default function AssessmentWizard() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [taskId, setTaskId] = useState<string>();
  const [templates, setTemplates] = useState<any[]>([]);
  const [template, setTemplate] = useState<any>();
  const [assets, setAssets] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [form] = Form.useForm();
  const templateId = Form.useWatch('templateId', form);

  useEffect(() => {
    Promise.all([
      apiClient.get('/templates', { params: { pageSize: 100 } }),
      apiClient.get('/assets', { params: { pageSize: 100, status: 'active' } }),
      apiClient.get('/lookup/departments'),
      apiClient.get('/lookup/personnel'),
    ]).then(([t, a, d, p]: any[]) => {
      setTemplates(t.data?.items || []);
      setAssets(a.data?.items || []);
      setDepartments(d.data || []);
      setPeople(p.data || []);
    });
  }, []);

  useEffect(() => {
    if (!templateId) return;
    apiClient.get(`/templates/${templateId}`).then((response: any) => setTemplate(response.data));
  }, [templateId]);

  const selectedAssets = useMemo(
    () => assets.filter((asset) => selectedAssetIds.includes(asset.id)),
    [assets, selectedAssetIds],
  );

  const createDraft = async () => {
    const values = await form.validateFields(['templateId', 'name', 'departmentId', 'period']);
    const chosen = templates.find((item) => item.id === values.templateId);
    const response: any = await apiClient.post('/tasks', {
      templateId: values.templateId,
      name: values.name,
      assessmentTarget: values.name,
      assessmentType: chosen?.name || '标准评估',
      departmentId: values.departmentId,
      periodStart: values.period?.[0]?.format('YYYY-MM-DD'),
      periodEnd: values.period?.[1]?.format('YYYY-MM-DD'),
    });
    setTaskId(response.data.id);
  };

  const buildMatrix = () => {
    const defaultDepartmentId = form.getFieldValue('departmentId');
    const controlPoints = template?.templateQuestions || [];
    setMatrix(buildControlAssetMatrix(controlPoints, selectedAssets, defaultDepartmentId));
  };

  const next = async () => {
    setLoading(true);
    try {
      if (current === 0) {
        await form.validateFields(['templateId']);
      } else if (current === 1) {
        if (!taskId) await createDraft();
      } else if (current === 2) {
        if (!selectedAssetIds.length) throw new Error('至少选择一个资产');
        await apiClient.put(`/tasks/${taskId}/assets`, { assetIds: selectedAssetIds });
        buildMatrix();
      } else if (current === 3) {
        if (matrix.some((row) => !row.assignedTo || !row.responsibleDepartmentId)) {
          throw new Error('请为每个评估单元指定责任人和责任部门');
        }
        await apiClient.put(`/tasks/${taskId}/control-asset-matrix`, {
          items: matrix.map(({ controlPointId, assetId, assignedTo, responsibleDepartmentId }) => ({
            controlPointId, assetId, assignedTo, responsibleDepartmentId,
          })),
        });
      }
      setCurrent((value) => value + 1);
    } catch (error) {
      message.error(getApiErrorMessage(error, error instanceof Error ? error.message : '保存失败'));
    } finally {
      setLoading(false);
    }
  };

  const publish = async () => {
    setLoading(true);
    try {
      await apiClient.post(`/tasks/${taskId}/publish`);
      message.success(`评估已发布，共生成 ${matrix.length} 个评估单元`);
      navigate(`/assessments/${taskId}/workbench`);
    } catch (error) {
      message.error(getApiErrorMessage(error, '发布失败'));
    } finally {
      setLoading(false);
    }
  };

  const updateMatrix = (key: string, field: 'assignedTo' | 'responsibleDepartmentId', value: string) => {
    setMatrix((rows) => rows.map((row) => row.key === key ? { ...row, [field]: value } : row));
  };

  const stepContent = [
    <Form.Item key="template" name="templateId" label="标准版本" rules={[{ required: true, message: '请选择标准' }]}>
      <Select
        size="large"
        placeholder="选择要逐项检查的合规标准"
        options={templates.map((item) => ({ value: item.id, label: `${item.name}（${item.questionCount} 个控制项）` }))}
      />
    </Form.Item>,
    <Space key="basic" direction="vertical" style={{ width: '100%' }} size={0}>
      <Form.Item name="name" label="评估名称" rules={[{ required: true }]}><Input size="large" /></Form.Item>
      <Form.Item name="departmentId" label="归属部门" rules={[{ required: true }]}>
        <Select size="large" options={departments.map((item) => ({ value: item.id, label: `${item.name} (${item.code})` }))} />
      </Form.Item>
      <Form.Item name="period" label="评估周期"><DatePicker.RangePicker style={{ width: '100%' }} /></Form.Item>
    </Space>,
    <Select
      key="assets"
      mode="multiple"
      size="large"
      style={{ width: '100%' }}
      value={selectedAssetIds}
      onChange={setSelectedAssetIds}
      placeholder="选择本次评估涉及的资产"
      optionFilterProp="label"
      options={assets.map((asset) => ({
        value: asset.id,
        label: `${asset.code} · ${asset.name}`,
      }))}
    />,
    <Table
      key="matrix"
      rowKey="key"
      size="small"
      virtual
      pagination={false}
      scroll={{ x: 1200, y: 460 }}
      dataSource={matrix}
      columns={[
        { title: '控制项', dataIndex: 'sequenceNumber', width: 100 },
        { title: '控制点', dataIndex: 'controlPoint', ellipsis: true },
        { title: '资产', dataIndex: 'assetName', width: 180 },
        {
          title: '责任部门',
          width: 180,
          render: (_, row) => (
            <Select
              value={row.responsibleDepartmentId}
              style={{ width: '100%' }}
              onChange={(value) => updateMatrix(row.key, 'responsibleDepartmentId', value)}
              options={departments.map((item) => ({ value: item.id, label: item.name }))}
            />
          ),
        },
        {
          title: '责任人',
          width: 180,
          render: (_, row) => (
            <Select
              value={row.assignedTo}
              showSearch
              optionFilterProp="label"
              style={{ width: '100%' }}
              onChange={(value) => updateMatrix(row.key, 'assignedTo', value)}
              options={people.map((item) => ({ value: item.userId, label: item.displayName || item.username }))}
            />
          ),
        },
      ]}
    />,
    <Alert
      key="preview"
      type="info"
      showIcon
      message="发布预览"
      description={`将按 ${template?.templateQuestions?.length || 0} 个控制项与 ${selectedAssets.length} 个资产的矩阵，生成 ${matrix.length} 个独立评估单元。发布后范围与矩阵不可直接修改。`}
    />,
  ][current];

  return (
    <div>
      <Typography.Title level={3}>创建评估</Typography.Title>
      <Card>
        <Steps
          current={current}
          items={['标准版本', '基本信息', '资产范围', '控制项资产矩阵', '人员分配与预览'].map((title) => ({ title }))}
          style={{ marginBottom: 32 }}
        />
        <Form form={form} layout="vertical" style={{ minHeight: 260 }}>
          {stepContent}
        </Form>
        <Space style={{ width: '100%', justifyContent: 'flex-end', marginTop: 24 }}>
          {current > 0 && <Button onClick={() => setCurrent((value) => value - 1)}>上一步</Button>}
          {current < 4
            ? <Button type="primary" loading={loading} onClick={next}>下一步</Button>
            : <Button type="primary" loading={loading} onClick={publish}>发布评估</Button>}
        </Space>
      </Card>
    </div>
  );
}
