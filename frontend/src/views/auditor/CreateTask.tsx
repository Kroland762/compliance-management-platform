import { useState, useEffect } from 'react';
import { Form, Input, Button, message, Typography, Select } from 'antd';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../utils/error';

const { Title } = Typography;

export default function CreateTask() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  useEffect(() => {
    apiClient.get('/templates').then((res: any) => setTemplates(res.data?.items || []));
  }, []);

  const handleSubmit = async (values: any) => {
    setLoading(true);
    try {
      await apiClient.post('/tasks', {
        templateId: values.templateId,
        assessmentType: values.assessmentType,
        assessmentTarget: values.assessmentTarget,
      });
      message.success('审计任务已创建，请配置问题和指派普通用户');
      form.resetFields();
      navigate('/tasks/review');
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '创建失败'));
    } finally { setLoading(false); }
  };

  return (
    <div style={{ maxWidth: 520 }}>
      <Title level={3} style={{ fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 24 }}>创建审计任务</Title>
      <div style={{
        background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 18, padding: '28px 32px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 0.5px rgba(0,0,0,0.04)',
      }}>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="assessmentType" label="评估方式" rules={[{ required: true, message: '请输入评估方式' }]}>
            <Input placeholder="例如：ISO 27001、网络安全等级保护" size="large" />
          </Form.Item>
          <Form.Item name="assessmentTarget" label="评估对象" rules={[{ required: true, message: '请输入评估对象' }]}>
            <Input placeholder="例如：核心业务系统、财务管理系统" size="large" />
          </Form.Item>
          <Form.Item name="templateId" label="合规模板" rules={[{ required: true, message: '请选择合规模板' }]}>
            <Select placeholder="选择审计问卷" size="large"
              options={templates.map((t: any) => ({ value: t.id, label: `${t.name}（${t.questionCount}题）` }))} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block size="large"
            style={{ borderRadius: 12, fontWeight: 500, marginTop: 8 }}>
            创建任务（下一步：配置责任分配）
          </Button>
        </Form>
      </div>
    </div>
  );
}
