import { Button, Result, Spin } from 'antd';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';

interface PrivateRouteProps {
  children: React.ReactNode;
  /** 权限检查: [resource, action]，满足任一即可 */
  permission?: [string, string];
  /** 权限不足时返回当前业务模块，避免跳到无关工作台 */
  fallbackPath?: string;
}

export default function PrivateRoute({ children, permission, fallbackPath = '/dashboard' }: PrivateRouteProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const initialized = useAuthStore((s) => s.initialized);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const selectedTenant = useAuthStore((s) => s.selectedTenant);
  const location = useLocation();
  const navigate = useNavigate();

  if (!initialized) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, height: '100vh' }}><Spin size="large" /><span>正在加载账号信息</span></div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (useAuthStore.getState().user?.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  if (!selectedTenant && location.pathname !== '/tenants') {
    return <Navigate to="/tenant-select" replace />;
  }

  if (permission) {
    const [resource, action] = permission;
    if (!hasPermission(resource, action)) {
      return <Result
        status="403"
        title="无权访问此页面"
        subTitle="当前账号缺少所需权限。如需访问，请联系管理员调整角色权限。"
        extra={<Button type="primary" onClick={() => navigate(fallbackPath, { replace: true })}>返回可访问页面</Button>}
      />;
    }
  }

  return <>{children}</>;
}
