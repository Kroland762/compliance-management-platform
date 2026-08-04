import { App, Button, Card, Form, Input, Typography } from 'antd';
import { Navigate, useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';
import { getApiErrorMessage } from '../utils/error';

const { Title, Text } = Typography;

export default function ChangePassword() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to={user.tenantId ? '/dashboard' : '/tenant-select'} replace />;

  const submit = async (values: { oldPassword: string; newPassword: string }) => {
    try {
      await apiClient.post('/auth/change-password', values);
      message.success('密码已修改，请重新登录');
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      message.error(getApiErrorMessage(error, '密码修改失败'));
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F7', display: 'grid', placeItems: 'center', padding: 24 }}>
      <Card style={{ width: 420 }}>
        <Title level={3}>首次登录修改密码</Title>
        <Text type="secondary">临时密码只能用于本次登录。新密码至少 8 位，并包含大小写字母、数字和特殊字符。</Text>
        <Form layout="vertical" onFinish={submit} style={{ marginTop: 24 }}>
          <Form.Item name="oldPassword" label="临时密码" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true }, { min: 8 }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  return !value || getFieldValue('newPassword') === value
                    ? Promise.resolve()
                    : Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>修改密码并重新登录</Button>
        </Form>
      </Card>
    </div>
  );
}
