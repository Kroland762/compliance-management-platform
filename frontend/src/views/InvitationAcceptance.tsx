import { App, Button, Card, Result } from 'antd';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';
import { getApiErrorMessage } from '../utils/error';

export default function InvitationAcceptance() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const [loading, setLoading] = useState(false);
  const tenantId = params.get('tenantId') || '';
  const token = params.get('token') || '';

  if (!user) {
    return <Navigate to="/login" state={{ from: `/accept-invitation?${params.toString()}` }} replace />;
  }

  const accept = async () => {
    setLoading(true);
    try {
      await apiClient.post(`/auth/invitations/${encodeURIComponent(token)}/accept`, { tenantId });
      await refreshToken();
      message.success('邀请已接受');
      navigate('/tenant-select', { replace: true });
    } catch (error) {
      message.error(getApiErrorMessage(error, '邀请接受失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F7', display: 'grid', placeItems: 'center', padding: 24 }}>
      <Card style={{ width: 520 }}>
        <Result
          status={tenantId && token ? 'info' : 'error'}
          title={tenantId && token ? '接受租户邀请' : '邀请链接无效'}
          subTitle="接受后将为当前登录身份创建独立的租户成员、角色和部门关系。"
          extra={tenantId && token
            ? <Button type="primary" loading={loading} onClick={accept}>确认接受</Button>
            : <Button onClick={() => navigate('/tenant-select')}>返回</Button>}
        />
      </Card>
    </div>
  );
}
