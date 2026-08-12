import { Navigate, useLocation } from 'react-router-dom';
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

  if (!initialized) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#AEAEB2' }}>加载中...</div>;
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
      return <Navigate to={fallbackPath} replace />;
    }
  }

  return <>{children}</>;
}
