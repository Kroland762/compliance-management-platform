import { useEffect, useState } from 'react';
import { Button, DatePicker, Form, Input, message, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { ExportOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../utils/error';

const level: Record<string, { text: string; color: string }> = {
  critical: { text: '严重', color: 'magenta' },
  high: { text: '高', color: 'red' },
  medium: { text: '中', color: 'orange' },
  low: { text: '低', color: 'green' },
};

export default function RiskManagement() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(Boolean(searchParams.get('sources')));
  const [tasks, setTasks] = useState<any[]>([]);
  const [evaluations, setEvaluations] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [form] = Form.useForm();
  const taskId = Form.useWatch('taskId', form);

  const load = async (page = pagination.current, pageSize = pagination.pageSize) => {
    setLoading(true);
    try {
      const response: any = await apiClient.get('/risks', { params: { page, pageSize } });
      setItems(response.data?.items || []);
      setPagination({ current: response.data?.pagination?.page || page, pageSize, total: response.data?.pagination?.total || 0 });
    } finally { setLoading(false); }
  };

  useEffect(() => {
    load(1);
    Promise.all([
      apiClient.get('/tasks', { params: { pageSize: 100 } }),
      apiClient.get('/assets', { params: { pageSize: 100, status: 'active' } }),
      apiClient.get('/lookup/departments'),
      apiClient.get('/lookup/personnel'),
    ]).then(([t, a, d, p]: any[]) => {
      setTasks(t.data?.items || []);
      setAssets(a.data?.items || []);
      setDepartments(d.data || []);
      setPeople(p.data || []);
      const initialTaskId = searchParams.get('taskId');
      const sources = searchParams.get('sources')?.split(',').filter(Boolean);
      if (initialTaskId) form.setFieldsValue({ taskId: initialTaskId, sourceIds: sources });
    });
  }, []);

  useEffect(() => {
    if (!taskId) return setEvaluations([]);
    apiClient.get(`/tasks/${taskId}/evaluations`, { params: { pageSize: 100, workflowStatus: 'reviewed' } })
      .then((response: any) => setEvaluations(response.data?.items || []));
  }, [taskId]);

  const create = async (values: any) => {
    try {
      await apiClient.post('/risks', {
        taskId: values.taskId,
        title: values.title,
        description: values.description,
        riskLevel: values.riskLevel,
        treatmentStrategy: values.treatmentStrategy,
        ownerDepartmentId: values.ownerDepartmentId,
        ownerUserId: values.ownerUserId,
        dueDate: values.dueDate?.format('YYYY-MM-DD'),
        sources: values.sourceIds.map((controlEvaluationId: string, index: number) => ({
          controlEvaluationId,
          relationType: index === 0 ? 'primary' : 'supporting',
        })),
        assets: values.assetIds.map((assetId: string) => ({ assetId })),
      });
      message.success('风险已创建，等待确认');
      setOpen(false);
      form.resetFields();
      load(1);
    } catch (error) {
      message.error(getApiErrorMessage(error, '创建风险失败'));
    }
  };

  const exportReport = async () => {
    try {
      const response: any = await apiClient.get('/export/risks', { responseType: 'blob' });
      const url = URL.createObjectURL(response instanceof Blob ? response : new Blob([response]));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'risk-relationship-report.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      message.error(getApiErrorMessage(error, '导出失败'));
    }
  };

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>风险管理</Typography.Title>
          <Typography.Text type="secondary">风险可关联多个评估来源和多个受影响资产</Typography.Text>
        </div>
        <Space>
          <Button icon={<ExportOutlined />} onClick={exportReport}>导出多工作表报告</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>创建风险</Button>
        </Space>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        pagination={pagination}
        onChange={(next) => load(next.current, next.pageSize)}
        onRow={(record) => ({ onClick: () => navigate(`/risks/${record.id}`), style: { cursor: 'pointer' } })}
        columns={[
          { title: '编号', dataIndex: 'code', width: 190 },
          { title: '风险', dataIndex: 'title' },
          { title: '等级', dataIndex: 'riskLevel', width: 90, render: (value) => <Tag color={level[value]?.color}>{level[value]?.text || value}</Tag> },
          { title: '来源', width: 80, render: (_, record) => record.sources?.length || 0 },
          { title: '资产', width: 80, render: (_, record) => record.affectedAssets?.length || 0 },
          { title: '行动', width: 80, render: (_, record) => record.actionLinks?.length || 0 },
          { title: '状态', dataIndex: 'status', width: 170 },
          { title: '期限', dataIndex: 'dueDate', width: 120 },
        ]}
      />
      <Modal width={760} title="创建多来源风险" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={create} preserve={false}>
          <Form.Item name="taskId" label="所属评估" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={tasks.map((task) => ({ value: task.id, label: task.name || task.assessmentTarget }))} />
          </Form.Item>
          <Form.Item name="sourceIds" label="来源评估单元" rules={[{ required: true, type: 'array', min: 1 }]}>
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              options={evaluations.map((item) => ({
                value: item.id,
                label: `${item.sequenceNumber} · ${item.asset?.name || ''} · ${item.controlPoint}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="assetIds" label="受影响资产" rules={[{ required: true, type: 'array', min: 1 }]}>
            <Select mode="multiple" showSearch optionFilterProp="label" options={assets.map((asset) => ({ value: asset.id, label: `${asset.code} · ${asset.name}` }))} />
          </Form.Item>
          <Form.Item name="title" label="风险标题" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="风险描述" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
          <Space style={{ width: '100%' }} align="start">
            <Form.Item name="riskLevel" label="风险等级" rules={[{ required: true }]} style={{ width: 150 }}>
              <Select options={Object.entries(level).map(([value, option]) => ({ value, label: option.text }))} />
            </Form.Item>
            <Form.Item name="treatmentStrategy" label="处置策略" initialValue="mitigate" style={{ width: 180 }}>
              <Select options={[
                { value: 'mitigate', label: '降低' },
                { value: 'accept', label: '接受' },
                { value: 'avoid', label: '规避' },
                { value: 'transfer', label: '转移' },
              ]} />
            </Form.Item>
            <Form.Item name="dueDate" label="整改期限"><DatePicker /></Form.Item>
          </Space>
          <Space style={{ width: '100%' }} align="start">
            <Form.Item name="ownerDepartmentId" label="责任部门" rules={[{ required: true }]} style={{ width: 300 }}>
              <Select options={departments.map((item) => ({ value: item.id, label: item.name }))} />
            </Form.Item>
            <Form.Item name="ownerUserId" label="负责人" rules={[{ required: true }]} style={{ width: 300 }}>
              <Select showSearch optionFilterProp="label" options={people.map((item) => ({ value: item.userId, label: item.displayName || item.username }))} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
