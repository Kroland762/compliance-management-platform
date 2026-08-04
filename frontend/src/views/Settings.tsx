import { useState, useEffect, type CSSProperties } from 'react';
import { Card, Form, InputNumber, Input, Button, App, Spin, Space } from 'antd';
import { SecurityScanOutlined, ClockCircleOutlined, LockOutlined, KeyOutlined, FileTextOutlined } from '@ant-design/icons';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';

interface SecuritySettings {
  maxLoginAttempts: number;
  lockDurationMinutes: number;
  idleTimeoutMinutes: number;
  auditLogRetentionDays: number;
}

const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  maxLoginAttempts: 5,
  lockDurationMinutes: 15,
  idleTimeoutMinutes: 180,
  auditLogRetentionDays: 365,
};

const cardStyle: CSSProperties = {
  borderRadius: 16,
  border: '0.5px solid rgba(0,0,0,0.08)',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};
const btnStyle: CSSProperties = {
  height: 40,
  borderRadius: 10,
  fontWeight: 500,
  paddingLeft: 28,
  paddingRight: 28,
};
const hintStyle: CSSProperties = { fontSize: 13, color: '#8E8E93' };
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const headingStyle: CSSProperties = { fontSize: 15, fontWeight: 600, color: '#1D1D1F' };
const policySectionStyle: CSSProperties = {
  padding: '24px 24px 4px',
  borderTop: '0.5px solid rgba(0,0,0,0.06)',
};
const fieldWidth = 200;

interface SettingFieldProps {
  name: keyof SecuritySettings;
  label: string;
  min: number;
  max: number;
  unit: string;
  hint: string;
}

function SettingField({ name, label, min, max, unit, hint }: SettingFieldProps) {
  return (
    <Form.Item label={label}>
      <div className="settings-field-row" style={rowStyle}>
        <Space.Compact style={{ width: fieldWidth, maxWidth: '100%' }}>
          <Form.Item name={name} noStyle rules={[{ required: true, message: `请设置${label}` }]}>
            <InputNumber min={min} max={max} style={{ width: 142 }} />
          </Form.Item>
          <Input
            aria-label={`${label}单位`}
            value={unit}
            readOnly
            tabIndex={-1}
            style={{ width: 58, textAlign: 'center', pointerEvents: 'none', color: '#636366' }}
          />
        </Space.Compact>
        <span style={hintStyle}>{hint}</span>
      </div>
    </Form.Item>
  );
}

export default function Settings() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [pwdForm] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);
  const can = useAuthStore((s) => s.hasPermission);
  const isAdmin = can('settings', 'update');

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res: any = await apiClient.get('/settings/security');
      form.setFieldsValue({ ...DEFAULT_SECURITY_SETTINGS, ...(res.data || {}) });
    } catch {
      message.error('加载设置失败');
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchSettings(); }, []);

  const handleSave = async (values: SecuritySettings) => {
    if (!isAdmin) { message.error('仅管理员可修改设置'); return; }
    setSaving(true);
    try {
      const res: any = await apiClient.put('/settings/security', values);
      form.setFieldsValue(res.data);
      message.success('安全设置已更新');
      window.dispatchEvent(new CustomEvent('security-settings-updated', { detail: res.data }));
    } catch (err: any) {
      message.error(err?.error?.message || '保存失败');
    } finally { setSaving(false); }
  };

  const handleChangePassword = async (values: { oldPassword: string; newPassword: string; confirmPassword: string }) => {
    if (values.newPassword !== values.confirmPassword) { message.error('两次输入的新密码不一致'); return; }
    setChangingPwd(true);
    try {
      await apiClient.post('/auth/change-password', { oldPassword: values.oldPassword, newPassword: values.newPassword });
      message.success('密码修改成功');
      pwdForm.resetFields();
    } catch (err: any) {
      message.error(err?.error?.message || '密码修改失败');
    } finally { setChangingPwd(false); }
  };

  return (
    <Spin spinning={loading}>
    <div>
    <Form form={form} layout="vertical" onFinish={handleSave} disabled={!isAdmin}
      initialValues={DEFAULT_SECURITY_SETTINGS}>
      <Card style={cardStyle} styles={{ body: { padding: 0 } }}>
        {/* 登录锁定策略 */}
        <section style={{ ...policySectionStyle, borderTop: 0 }}>
          <div style={{ ...headingStyle, marginBottom: 20 }}>
            <LockOutlined style={{ marginRight: 8, color: '#007AFF' }} />
            登录锁定策略
          </div>
          <SettingField
            name="maxLoginAttempts"
            label="最大登录失败次数"
            min={1}
            max={20}
            unit="次"
            hint="连续失败达到此次数后，账户将被临时锁定"
          />
          <SettingField
            name="lockDurationMinutes"
            label="锁定时长"
            min={1}
            max={1440}
            unit="分钟"
            hint="账户被锁定后的自动解锁时间"
          />
        </section>

        {/* 会话超时 */}
        <section style={policySectionStyle}>
          <div style={{ ...headingStyle, marginBottom: 20 }}>
            <ClockCircleOutlined style={{ marginRight: 8, color: '#007AFF' }} />
            会话超时
          </div>
          <SettingField
            name="idleTimeoutMinutes"
            label="空闲自动登出"
            min={5}
            max={1440}
            unit="分钟"
            hint="用户无操作超过此时间后将自动退出登录"
          />
        </section>

        {/* 日志保留 */}
        <section style={policySectionStyle}>
          <div style={{ ...headingStyle, marginBottom: 20 }}>
            <FileTextOutlined style={{ marginRight: 8, color: '#007AFF' }} />
            审计日志保留策略
          </div>
          <SettingField
            name="auditLogRetentionDays"
            label="日志保留天数"
            min={0}
            max={3650}
            unit="天"
            hint="超过保留天数的日志将在每日凌晨自动清理。设为 0 表示永久保留"
          />
        </section>

        {/* 保存按钮 */}
        {isAdmin && (
          <div style={{
            padding: '16px 24px',
            borderTop: '0.5px solid rgba(0,0,0,0.06)',
            background: 'rgba(0,0,0,0.015)',
            display: 'flex',
            justifyContent: 'flex-start',
          }}>
            <Button type="primary" htmlType="submit" loading={saving} style={btnStyle}>保存设置</Button>
          </div>
        )}
      </Card>
    </Form>

    {/* 修改密码 + 密码复杂度 */}
    <Card style={{ marginTop: 24, ...cardStyle }}>
      <div style={{ ...headingStyle, marginBottom: 20 }}><KeyOutlined style={{ marginRight: 8, color: '#007AFF' }} />修改密码</div>

      <Form form={pwdForm} layout="vertical" onFinish={handleChangePassword}>
        <Form.Item name="oldPassword" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
          <Input.Password placeholder="输入当前密码" style={{ width: fieldWidth, maxWidth: '100%', borderRadius: 10 }} />
        </Form.Item>

        <Form.Item name="newPassword" label="新密码"
          rules={[
            { required: true, message: '请输入新密码' }, { min: 8, message: '密码长度不能少于 8 位' },
            { pattern: /[a-z]/, message: '须含小写字母' }, { pattern: /[A-Z]/, message: '须含大写字母' },
            { pattern: /[0-9]/, message: '须含数字' },
            { pattern: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/, message: '须含特殊字符' },
          ]}>
          <Input.Password placeholder="输入新密码" style={{ width: fieldWidth, maxWidth: '100%', borderRadius: 10 }} />
        </Form.Item>

        <Form.Item name="confirmPassword" label="确认新密码"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请确认新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                return Promise.reject(new Error('两次输入的密码不一致'));
              },
            }),
          ]}>
          <Input.Password placeholder="再次输入新密码" style={{ width: fieldWidth, maxWidth: '100%', borderRadius: 10 }} />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={changingPwd} style={btnStyle}>修改密码</Button>
        </Form.Item>
      </Form>

      <div style={{ marginTop: 24, paddingTop: 20, borderTop: '0.5px solid rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>
          <SecurityScanOutlined style={{ marginRight: 6, color: '#34C759' }} />密码复杂度要求
        </div>
        <ul className="settings-password-rules" style={{ margin: 0, paddingLeft: 20, color: '#636366', fontSize: 14, lineHeight: 2, columns: 2 }}>
          <li>长度不少于 8 位</li>
          <li>必须包含大写字母（A-Z）</li>
          <li>必须包含小写字母（a-z）</li>
          <li>必须包含数字（0-9）</li>
          <li>必须包含特殊字符（如 !@#$% 等）</li>
        </ul>
      </div>
    </Card>
    </div>
    </Spin>
  );
}
