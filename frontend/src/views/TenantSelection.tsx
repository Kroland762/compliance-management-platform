import { App, Button, Card, Empty, Space, Typography } from 'antd';
import { HomeOutlined, LogoutOutlined } from '@ant-design/icons';
import { Navigate, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuthStore } from '../store/auth';
import { getApiErrorMessage } from '../utils/error';

const { Title, Text } = Typography;

export default function TenantSelection() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const contexts = useAuthStore((state) => state.contexts);
  const user = useAuthStore((state) => state.user);
  const selectContext = useAuthStore((state) => state.selectContext);
  const logout = useAuthStore((state) => state.logout);
  const [loadingId, setLoadingId] = useState('');

  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (user.tenantId) return <Navigate to="/dashboard" replace />;

  const enter = async (tenantId: string) => {
    setLoadingId(tenantId);
    try {
      await selectContext(tenantId);
      navigate('/dashboard', { replace: true });
    } catch (error) {
      message.error(getApiErrorMessage(error, '租户上下文切换失败'));
    } finally {
      setLoadingId('');
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F7', padding: '72px 24px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <Title level={2} style={{ marginBottom: 4 }}>选择租户</Title>
            <Text type="secondary">进入租户后，角色、部门和数据范围将按该成员身份加载。</Text>
          </div>
          <Button icon={<LogoutOutlined />} onClick={async () => { await logout(); navigate('/login'); }}>
            退出
          </Button>
        </Space>
        {contexts.length === 0 ? (
          <Card><Empty description="当前没有可进入的租户；请接受邀请或联系管理员。" /></Card>
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {contexts.map((context) => (
              <Card key={context.id} hoverable>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Space>
                    <HomeOutlined style={{ fontSize: 22, color: '#1677ff' }} />
                    <div>
                      <Text strong>{context.name}</Text>
                      <div><Text type="secondary">{context.slug}</Text></div>
                    </div>
                  </Space>
                  <Button type="primary" loading={loadingId === context.id} onClick={() => enter(context.id)}>
                    进入
                  </Button>
                </Space>
              </Card>
            ))}
          </Space>
        )}
      </div>
    </div>
  );
}
