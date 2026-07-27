import { useState, useEffect } from 'react';
import { Modal, Steps, Button, Form, Select, Checkbox, Radio, Input, Typography, message, Space, List, Tag } from 'antd';
import { DatabaseOutlined, AuditOutlined, ScheduleOutlined } from '@ant-design/icons';
import { taskApi, dataSourceApi, ruleApi } from '../../api/account';
import { getApiErrorMessage } from '../../utils/error';

const { Text, Title } = Typography;

interface Props {
  open: boolean;
  editingTask?: any;
  onClose: () => void;
  onSuccess: () => void;
}

export default function TaskForm({ open, editingTask, onClose, onSuccess }: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  // Step 1: Data Sources
  const [dataSources, setDataSources] = useState<any[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string>('');

  // Step 2: Rules
  const [rules, setRules] = useState<any[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [selectedRules, setSelectedRules] = useState<string[]>([]);

  // Step 3: Schedule
  const [scheduleType, setScheduleType] = useState<string>('MANUAL');

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
          cronExpression: editingTask.cronExpression,
        });
        setSelectedSource(editingTask.sourceId || '');
        setSelectedRules(editingTask.selectedRules || []);
        setScheduleType(editingTask.scheduleType || 'MANUAL');
      }
    }
  }, [open, editingTask]);

  const loadDataSources = () => {
    setSourcesLoading(true);
    dataSourceApi.list()
      .then((res: any) => setDataSources(res.data?.items || []))
      .catch(() => message.error('获取数据源失败'))
      .finally(() => setSourcesLoading(false));
  };

  const loadRules = () => {
    setRulesLoading(true);
    ruleApi.list({ isActive: true })
      .then((res: any) => setRules(res.data?.items || []))
      .catch(() => message.error('获取规则失败'))
      .finally(() => setRulesLoading(false));
  };

  const handleNext = () => {
    if (currentStep === 0 && !selectedSource) {
      message.warning('请选择一个数据源');
      return;
    }
    if (currentStep === 1 && selectedRules.length === 0) {
      message.warning('请至少选择一条规则');
      return;
    }
    if (currentStep === 0) loadRules();
    setCurrentStep(prev => prev + 1);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const payload = {
        ...values,
        sourceId: selectedSource,
        selectedRules,
        scheduleType,
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
            {dataSources.length === 0 && !sourcesLoading && (
              <Button onClick={loadDataSources} loading={sourcesLoading}>加载数据源</Button>
            )}
            <List
              loading={sourcesLoading}
              dataSource={dataSources}
              renderItem={(ds: any) => (
                <List.Item
                  onClick={() => setSelectedSource(ds.id)}
                  style={{
                    cursor: 'pointer',
                    padding: '10px 12px',
                    borderRadius: 10,
                    marginBottom: 4,
                    background: selectedSource === ds.id ? 'rgba(0,122,255,0.06)' : 'transparent',
                    border: selectedSource === ds.id ? '0.5px solid rgba(0,122,255,0.2)' : '0.5px solid transparent',
                    transition: 'all 0.15s',
                  }}
                >
                  <List.Item.Meta
                    avatar={<DatabaseOutlined style={{ fontSize: 18, color: '#007AFF' }} />}
                    title={<Text strong>{ds.name}</Text>}
                    description={
                      <Space size={8}>
                        <Tag color="blue" style={{ borderRadius: 4 }}>PostgreSQL</Tag>
                        <Text type="secondary">{ds.totalAccounts?.toLocaleString() || 0} 个账户</Text>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </div>
        );

      case 1:
        return (
          <div style={{ minHeight: 240 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              选择要应用的审计规则（可多选）
            </Text>
            <Checkbox.Group
              value={selectedRules}
              onChange={vals => setSelectedRules(vals as string[])}
              style={{ width: '100%' }}
            >
              <List
                loading={rulesLoading}
                dataSource={rules}
                renderItem={(rule: any) => (
                  <List.Item
                    style={{ padding: '8px 12px' }}
                  >
                    <Checkbox value={rule.id} style={{ width: '100%' }}>
                      <Space>
                        <Text strong>{rule.name}</Text>
                        <Tag color={rule.severity === 'CRITICAL' ? '#8B0000' : rule.severity === 'HIGH' ? 'red' : rule.severity === 'MEDIUM' ? 'orange' : 'green'}
                          style={{ borderRadius: 4 }}>
                          {rule.severity === 'HIGH' ? '高' : rule.severity === 'MEDIUM' ? '中' : '低'}
                        </Tag>
                        <Tag color={rule.ruleType === 'BUILTIN' ? 'blue' : 'purple'} style={{ borderRadius: 4 }}>
                          {rule.ruleType === 'BUILTIN' ? '内置' : '自定义'}
                        </Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>{rule.description}</Text>
                      </Space>
                    </Checkbox>
                  </List.Item>
                )}
              />
            </Checkbox.Group>
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
                <Radio.Group value={scheduleType} onChange={e => setScheduleType(e.target.value)}>
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
