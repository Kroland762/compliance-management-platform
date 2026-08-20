import { useState, useEffect } from 'react';
import { Modal, Steps, Button, Form, Select, Radio, Input, InputNumber, Typography, message, Space, TimePicker } from 'antd';
import { DatabaseOutlined, AuditOutlined, ScheduleOutlined } from '@ant-design/icons';
import { taskApi, type Task } from '../../api/account';
import { getApiErrorMessage } from '../../utils/error';
import dayjs from 'dayjs';
import { LookupSelect } from '../../components/lookups';

const { Text } = Typography;

interface Props {
  open: boolean;
  editingTask?: any;
  onClose: () => void;
  onSuccess: () => void;
}

export function buildScheduleConfig(scheduleType: Task['scheduleType'], values: Record<string, any>) {
  if (scheduleType === 'MANUAL') return null;
  if (scheduleType === 'CRON') return { expression: values.cronExpression.trim() };
  return {
    hour: values.scheduleTime?.hour() ?? 0,
    minute: values.scheduleTime?.minute() ?? 0,
    ...(scheduleType === 'WEEKLY' ? { dayOfWeek: values.dayOfWeek } : {}),
    ...(scheduleType === 'MONTHLY' ? { dayOfMonth: values.dayOfMonth } : {}),
  };
}

export default function TaskForm({ open, editingTask, onClose, onSuccess }: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  // Step 1: Data Sources
  const [selectedSource, setSelectedSource] = useState<string>('');

  // Step 2: Rules
  const [selectedRules, setSelectedRules] = useState<string[]>([]);

  // Step 3: Schedule
  const [scheduleType, setScheduleType] = useState<Task['scheduleType']>('MANUAL');

  useEffect(() => {
    if (open) {
      setCurrentStep(0);
      setSelectedSource('');
      setSelectedRules([]);
      setScheduleType('MANUAL');
      form.resetFields();

      if (editingTask) {
        form.setFieldsValue({
          name: editingTask.name,
          scheduleType: editingTask.scheduleType,
          cronExpression: editingTask.scheduleConfig?.expression,
          scheduleTime: editingTask.scheduleConfig?.hour !== undefined
            ? dayjs().hour(editingTask.scheduleConfig.hour).minute(editingTask.scheduleConfig.minute || 0)
            : dayjs().startOf('day'),
          dayOfWeek: editingTask.scheduleConfig?.dayOfWeek ?? 1,
          dayOfMonth: editingTask.scheduleConfig?.dayOfMonth ?? 1,
        });
        setSelectedSource(editingTask.sourceId || '');
        setSelectedRules(editingTask.selectedRules || []);
        setScheduleType(editingTask.scheduleType || 'MANUAL');
      }
    }
  }, [open, editingTask]);

  const handleNext = () => {
    if (currentStep === 0 && !selectedSource) {
      message.warning('请选择一个数据源');
      return;
    }
    if (currentStep === 1 && selectedRules.length === 0) {
      message.warning('请至少选择一条规则');
      return;
    }
    setCurrentStep(prev => prev + 1);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const scheduleConfig = buildScheduleConfig(scheduleType, values);
      const payload = {
        name: values.name,
        sourceId: selectedSource,
        selectedRules,
        scheduleType,
        scheduleConfig,
      };
      if (editingTask) {
        await taskApi.update(editingTask.id, payload);
        message.success('任务已更新');
      } else {
        await taskApi.create(payload);
        message.success('任务已创建');
      }
      onSuccess();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(getApiErrorMessage(err, editingTask ? '更新失败' : '创建失败'));
    } finally {
      setLoading(false);
    }
  };

  const stepItems = [
    { title: '选择数据源', icon: <DatabaseOutlined /> },
    { title: '选择规则', icon: <AuditOutlined /> },
    { title: '调度配置', icon: <ScheduleOutlined /> },
  ];

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div style={{ minHeight: 240 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              选择该任务需要审计的数据源
            </Text>
            <LookupSelect
              kind="account-data-sources"
              purpose="account-task-source"
              contextId={editingTask?.id}
              value={selectedSource || undefined}
              onChange={(value) => setSelectedSource(String(value))}
              placeholder="输入数据源名称检索"
              style={{ width: '100%' }}
            />
          </div>
        );

      case 1:
        return (
          <div style={{ minHeight: 240 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              选择要应用的审计规则（可多选）
            </Text>
            <LookupSelect
              kind="account-rules"
              purpose="account-task-rules"
              contextId={editingTask?.id}
              mode="multiple"
              value={selectedRules}
              onChange={(values) => setSelectedRules(values as string[])}
              placeholder="输入规则名称检索"
              style={{ width: '100%' }}
            />
          </div>
        );

      case 2:
        return (
          <div style={{ minHeight: 240 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
              配置任务的执行计划
            </Text>

            <Form form={form} layout="vertical" initialValues={{ name: editingTask?.name || '', scheduleType: 'MANUAL' }}>
              <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}>
                <Input placeholder="例如：每日账户审计" />
              </Form.Item>

              <Form.Item name="scheduleType" label="执行计划">
                <Radio.Group value={scheduleType} onChange={e => setScheduleType(e.target.value as Task['scheduleType'])}>
                  <Space direction="vertical">
                    <Radio value="MANUAL">手动执行</Radio>
                    <Radio value="DAILY">每日</Radio>
                    <Radio value="WEEKLY">每周</Radio>
                    <Radio value="MONTHLY">每月</Radio>
                    <Radio value="CRON">Cron 表达式</Radio>
                  </Space>
                </Radio.Group>
              </Form.Item>

              {scheduleType === 'CRON' && (
                <Form.Item name="cronExpression" label="Cron 表达式" rules={[{ required: true, message: '请输入 Cron 表达式' }]}>
                  <Input placeholder="0 2 * * * (每天凌晨2点)" />
                </Form.Item>
              )}
              {['DAILY', 'WEEKLY', 'MONTHLY'].includes(scheduleType) && (
                <Form.Item name="scheduleTime" label="执行时间" initialValue={dayjs().startOf('day')} rules={[{ required: true }]}>
                  <TimePicker format="HH:mm" />
                </Form.Item>
              )}
              {scheduleType === 'WEEKLY' && (
                <Form.Item name="dayOfWeek" label="执行星期" initialValue={1} rules={[{ required: true }]}>
                  <Select options={[
                    { value: 1, label: '星期一' }, { value: 2, label: '星期二' }, { value: 3, label: '星期三' },
                    { value: 4, label: '星期四' }, { value: 5, label: '星期五' }, { value: 6, label: '星期六' }, { value: 0, label: '星期日' },
                  ]} />
                </Form.Item>
              )}
              {scheduleType === 'MONTHLY' && (
                <Form.Item name="dayOfMonth" label="执行日期" initialValue={1} rules={[{ required: true }]}>
                  <InputNumber min={1} max={28} addonAfter="日" />
                </Form.Item>
              )}
            </Form>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Modal
      title={editingTask ? '编辑任务' : '创建任务'}
      open={open}
      onCancel={onClose}
      width={600}
      footer={null}
      destroyOnClose
    >
      <Steps current={currentStep} items={stepItems} size="small" style={{ marginBottom: 24, marginTop: 8 }} />

      {renderStepContent()}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <Button onClick={() => currentStep > 0 ? setCurrentStep(prev => prev - 1) : onClose()}>
          {currentStep === 0 ? '取消' : '上一步'}
        </Button>
        <div>
          {currentStep < 2 ? (
            <Button type="primary" onClick={handleNext}>下一步</Button>
          ) : (
            <Button type="primary" loading={loading} onClick={handleSubmit}>
              {editingTask ? '保存修改' : '创建任务'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
