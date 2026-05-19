import { useState, useEffect } from 'react';
import { Typography, Card, Form, InputNumber, Input, Button, App, Divider, Spin } from 'antd';
import { SecurityScanOutlined, ClockCircleOutlined, LockOutlined, KeyOutlined } from '@ant-design/icons';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';

const { Title, Text } = Typography;

interface SecuritySettings {
  maxLoginAttempts: number;
  lockDurationMinutes: number;
  idleTimeoutMinutes: number;
}

export default function Settings() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [pwdForm] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'administrator';

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res: any = await apiClient.get('/settings/security');
      form.setFieldsValue(res.data);
    } catch {
      message.error('加载设置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSettings(); }, []);

  const handleSave = async (values: SecuritySettings) => {
    if (!isAdmin) {
      message.error('仅管理员可修改设置');
      return;
    }
    setSaving(true);
    try {
      const res: any = await apiClient.put('/settings/security', values);
      form.setFieldsValue(res.data);
      message.success('安全设置已更新');
      window.dispatchEvent(new CustomEvent('security-settings-updated', { detail: res.data }));
    } catch (err: any) {
      message.error(err?.error?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (values: { oldPassword: string; newPassword: string; confirmPassword: string }) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error('两次输入的新密码不一致');
      return;
    }
    setChangingPwd(true);
    try {
      await apiClient.post('/auth/change-password', {
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });
      message.success('密码修改成功');
      pwdForm.resetFields();
    } catch (err: any) {
      message.error(err?.error?.message || '密码修改失败');
    } finally {
      setChangingPwd(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 120 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <Title level={3} style={{ fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 8 }}>
        <SecurityScanOutlined style={{ marginRight: 8, color: '#007AFF' }} />
        安全设置
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 32 }}>
        配置登录安全策略和会话超时
      </Text>

      <Card
        style={{
          borderRadius: 16,
          border: '0.5px solid rgba(0,0,0,0.08)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          disabled={!isAdmin}
          initialValues={{ maxLoginAttempts: 5, lockDurationMinutes: 15, idleTimeoutMinutes: 180 }}
        >
          <Divider orientation="left" plain style={{ fontSize: 14, fontWeight: 500, marginTop: 0 }}>
            <LockOutlined style={{ marginRight: 6 }} />
            登录锁定策略
          </Divider>

          <Form.Item
            name="maxLoginAttempts"
            label="最大登录失败次数"
            rules={[{ required: true, message: '请输入' }]}
            extra="连续失败达到此次数后，账户将被临时锁定"
          >
            <InputNumber
              min={1}
              max={20}
              style={{ width: 120 }}
              addonAfter="次"
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="lockDurationMinutes"
            label="锁定时长"
            rules={[{ required: true, message: '请输入' }]}
            extra="账户被锁定后的自动解锁时间"
          >
            <InputNumber
              min={1}
              max={1440}
              style={{ width: 120 }}
              addonAfter="分钟"
              size="large"
            />
          </Form.Item>

          <Divider orientation="left" plain style={{ fontSize: 14, fontWeight: 500 }}>
            <ClockCircleOutlined style={{ marginRight: 6 }} />
            会话超时
          </Divider>

          <Form.Item
            name="idleTimeoutMinutes"
            label="空闲自动登出"
            rules={[{ required: true, message: '请输入' }]}
            extra="用户无操作超过此时间后将自动退出登录"
          >
            <InputNumber
              min={5}
              max={1440}
              style={{ width: 120 }}
              addonAfter="分钟"
              size="large"
            />
          </Form.Item>

          {isAdmin && (
            <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={saving}
                style={{
                  height: 44,
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 500,
                  paddingLeft: 32,
                  paddingRight: 32,
                }}
              >
                保存设置
              </Button>
            </Form.Item>
          )}

          {!isAdmin && (
            <Text type="secondary" style={{ fontSize: 13 }}>
              仅管理员可修改安全设置。当前角色为只读查看。
            </Text>
          )}
        </Form>
      </Card>

      {/* 修改密码 */}
      <Card
        style={{
          marginTop: 24,
          borderRadius: 16,
          border: '0.5px solid rgba(0,0,0,0.08)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 20 }}>
          <KeyOutlined style={{ marginRight: 6, color: '#007AFF' }} />
          修改密码
        </Text>

        <Form
          form={pwdForm}
          layout="vertical"
          onFinish={handleChangePassword}
          style={{ maxWidth: 400 }}
        >
          <Form.Item
            name="oldPassword"
            label="当前密码"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password
              size="large"
              placeholder="输入当前密码"
              style={{ borderRadius: 10 }}
            />
          </Form.Item>

          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, message: '密码长度不能少于 8 位' },
              { pattern: /[a-z]/, message: '必须包含小写字母' },
              { pattern: /[A-Z]/, message: '必须包含大写字母' },
              { pattern: /[0-9]/, message: '必须包含数字' },
              { pattern: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/, message: '必须包含特殊字符' },
            ]}
            extra="至少 8 位，须包含大写字母、小写字母、数字和特殊字符"
          >
            <Input.Password
              size="large"
              placeholder="输入新密码"
              style={{ borderRadius: 10 }}
            />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请确认新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password
              size="large"
              placeholder="再次输入新密码"
              style={{ borderRadius: 10 }}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={changingPwd}
              style={{
                height: 44,
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 500,
                paddingLeft: 32,
                paddingRight: 32,
              }}
            >
              修改密码
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* 密码复杂度提示 */}
      <Card
        style={{
          marginTop: 24,
          borderRadius: 16,
          border: '0.5px solid rgba(0,0,0,0.08)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 12 }}>
          <SecurityScanOutlined style={{ marginRight: 6, color: '#34C759' }} />
          密码复杂度要求
        </Text>
        <ul style={{ margin: 0, paddingLeft: 20, color: '#636366', fontSize: 14, lineHeight: 2 }}>
          <li>长度不少于 8 位</li>
          <li>必须包含大写字母（A-Z）</li>
          <li>必须包含小写字母（a-z）</li>
          <li>必须包含数字（0-9）</li>
          <li>必须包含特殊字符（如 !@#$% 等）</li>
        </ul>
      </Card>
    </div>
  );
}
