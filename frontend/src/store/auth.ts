import { create } from 'zustand';
import apiClient from '../api/client';

interface User {
  id: string;
  username: string;
  role: string;
  roleId: string;
  permissions: Record<string, string[]>;
  department: string | null;
  email: string | null;
  tenantId?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  initialized: boolean;
  refreshPending: Promise<any> | null;
  selectedTenant: { id: string; name: string } | null;
  login: (username: string, password: string, captchaId?: string, captchaCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  loadFromStorage: () => void;
  hasPermission: (resource: string, action: string) => boolean;
  selectTenant: (tenant: { id: string; name: string } | null) => void;
}

const TENANT_SESSION_KEY = 'selectedTenant';

function readSelectedTenant(): { id: string; name: string } | null {
  try {
    const raw = sessionStorage.getItem(TENANT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const tenant = parsed?.version === 1 ? parsed.tenant : parsed;
    return typeof tenant?.id === 'string' && typeof tenant?.name === 'string' ? tenant : null;
  } catch {
    sessionStorage.removeItem(TENANT_SESSION_KEY);
    return null;
  }
}

function writeSelectedTenant(tenant: { id: string; name: string } | null): void {
  if (tenant) sessionStorage.setItem(TENANT_SESSION_KEY, JSON.stringify({ version: 1, tenant }));
  else sessionStorage.removeItem(TENANT_SESSION_KEY);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  initialized: false,
  refreshPending: null,
  selectedTenant: null,

  login: async (username: string, password: string, captchaId?: string, captchaCode?: string) => {
    const res: any = await apiClient.post('/auth/login', { username, password, captchaId, captchaCode }, { _skipRefresh: true } as any);
    const { token, user } = res.data;
    localStorage.setItem('user', JSON.stringify(user));
    const selectedTenant = user.tenantId ? { id: user.tenantId, name: '当前租户' } : null;
    writeSelectedTenant(selectedTenant);
    set({ token, user, selectedTenant, isAuthenticated: true });
  },

  logout: async () => {
    try { await apiClient.post('/auth/logout', {}, { _skipRefresh: true }); } catch {}
    localStorage.removeItem('user');
    writeSelectedTenant(null);
    set({ token: null, user: null, selectedTenant: null, isAuthenticated: false, refreshPending: null });
  },

  refreshToken: async () => {
    const pending = get().refreshPending;
    if (pending) return pending;
    const promise = apiClient.post('/auth/refresh', {}, { _skipRefresh: true })
      .then((res: any) => {
        const { token, user } = res.data;
        localStorage.setItem('user', JSON.stringify(user));
        const selectedTenant = user.tenantId
          ? { id: user.tenantId, name: '当前租户' }
          : readSelectedTenant();
        set({ token, user, selectedTenant, isAuthenticated: true, refreshPending: null, initialized: true });
      })
      .catch(() => {
        localStorage.removeItem('user');
        writeSelectedTenant(null);
        set({ token: null, user: null, selectedTenant: null, isAuthenticated: false, refreshPending: null, initialized: true });
        throw new Error('refresh failed');
      });
    set({ refreshPending: promise });
    return promise;
  },

  loadFromStorage: () => {
    const userStr = localStorage.getItem('user');
    if (userStr) set({ user: JSON.parse(userStr), selectedTenant: readSelectedTenant() });
  },

  hasPermission: (resource: string, action: string): boolean => {
    const user = get().user;
    if (!user?.permissions) return false;
    const allowed = user.permissions[resource];
    return Array.isArray(allowed) && allowed.includes(action);
  },

  selectTenant: (tenant) => {
    writeSelectedTenant(tenant);
    set({ selectedTenant: tenant });
  },
}));

// 暴露 store 到 window
(useAuthStore as any).subscribe((state: any) => {
  (window as any).__authStore = {
    token: state.token,
    user: state.user,
    selectedTenant: state.selectedTenant,
    isAuthenticated: state.isAuthenticated,
  };
  (window as any).__authSetState = useAuthStore.setState;
});

// 便捷导出
export function usePermission(resource: string, action: string): boolean {
  return useAuthStore((s) => s.hasPermission(resource, action));
}
