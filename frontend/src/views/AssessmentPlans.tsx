import { useEffect, useState } from 'react';
import { Button, Form, Input, message, Modal, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../utils/error';

export default function AssessmentPlans() {
  const [items, setItems] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const load = () => apiClient.get('/assessment-plans', { params: { pageSize: 100 } })
    .then((response: any) => setItems(response.data?.items || []));
  useEffect(() => {
    load();
    apiClient.get('/tasks', { params: { pageSize: 100 } }).then((response: any) => setTasks(response.data?.items || []));
  }, []);

  const create = async (values: any) => {
    try {
      const source = tasks.find((task) => task.id === values.sourceTaskId);
      const [scope, matrix]: any[] = await Promise.all([
        apiClient.get(`/tasks/${values.sourceTaskId}/assets`),
        apiClient.get(`/tasks/${values.sourceTaskId}/control-asset-matrix`),
      ]);
      await apiClient.post('/assessment-plans', {
        name: values.name,
        templateId: source.templateId,
        assessmentType: source.assessmentType,
        defaultDepartmentId: source.departmentId,
        cronExpression: values.cronExpression,
        timeZone: 'Asia/Shanghai',
        enabled: true,
        scopeSnapshot: (scope.data?.items || []).map((entry: any) => ({ assetId: entry.assetId })),
        matrixSnapshot: (matrix.data?.items || []).map((entry: any) => ({
          controlPointId: entry.controlPointId,
          assetId: entry.assetId,
          assignedTo: entry.assignedTo,
          responsibleDepartmentId: entry.responsibleDepartmentId,
        })),
      });
      message.success('周期评估计划已创建');
      setOpen(false);
      form.resetFields();
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '创建计划失败'));
    }
  };

  const trigger = async (id: string) => {
    try {
      const response: any = await apiClient.post(`/assessment-plans/${id}/trigger`);
      message.success(response.data?.status === 'requires_attention'
        ? '计划需要处理资产变化'
        : '已生成评估草稿，请确认范围和人员后发布');
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '触发失败'));
    }
  };

  const toggle = async (plan: any, enabled: boolean) => {
    try {
      await apiClient.put(`/assessment-plans/${plan.id}`, { enabled });
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '更新失败'));
    }
  };

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>周期评估计划</Typography.Title>
          <Typography.Text type="secondary">保存标准版本、资产范围和控制项矩阵快照，按计划自动创建评估</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建计划</Button>
      </Space>
      <Table
        rowKey="id"
        dataSource={items}
        columns={[
          { title: '计划名称', dataIndex: 'name' },
          { title: 'Cron', dataIndex: 'cronExpression', width: 180 },
          { title: '资产快照', width: 100, render: (_, plan) => plan.scopeSnapshot?.length || 0 },
          { title: '单元快照', width: 100, render: (_, plan) => plan.matrixSnapshot?.length || 0 },
          { title: '状态', width: 100, render: (_, plan) => <Tag color={plan.enabled ? 'green' : 'default'}>{plan.enabled ? '启用' : '停用'}</Tag> },
          {
            title: '操作',
            width: 190,
            render: (_, plan) => (
              <Space>
                <Switch size="small" checked={plan.enabled} onChange={(checked) => toggle(plan, checked)} />
                <Button size="small" icon={<PlayCircleOutlined />} disabled={!plan.enabled} onClick={() => trigger(plan.id)}>立即触发</Button>
              </Space>
            ),
          },
        ]}
      />
      <Modal title="新建周期评估计划" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={create} preserve={false}>
          <Form.Item name="name" label="计划名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="sourceTaskId" label="复制已配置评估的范围与矩阵" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={tasks.filter((task) => task.publishedAt).map((task) => ({ value: task.id, label: task.name || task.assessmentTarget }))} />
          </Form.Item>
          <Form.Item name="cronExpression" label="Cron 表达式" rules={[{ required: true }]} initialValue="0 9 1 * *">
            <Input placeholder="例如：每月1日9点 0 9 1 * *" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
