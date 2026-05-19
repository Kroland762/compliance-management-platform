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
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  initialized: boolean;
  refreshPending: Promise<any> | null;
  login: (username: string, password: string, captchaId?: string, captchaCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  loadFromStorage: () => void;
  hasPermission: (resource: string, action: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  initialized: false,
  refreshPending: null,

  login: async (username: string, password: string, captchaId?: string, captchaCode?: string) => {
    const res: any = await apiClient.post('/auth/login', { username, password, captchaId, captchaCode }, { _skipRefresh: true } as any);
    const { token, user } = res.data;
    localStorage.setItem('user', JSON.stringify(user));
    set({ token, user, isAuthenticated: true });
  },

  logout: async () => {
    try { await apiClient.post('/auth/logout', {}, { _skipRefresh: true }); } catch {}
    localStorage.removeItem('user');
    set({ token: null, user: null, isAuthenticated: false, refreshPending: null });
  },

  refreshToken: async () => {
    const pending = get().refreshPending;
    if (pending) return pending;
    const promise = apiClient.post('/auth/refresh', {}, { _skipRefresh: true })
      .then((res: any) => {
        const { token, user } = res.data;
        localStorage.setItem('user', JSON.stringify(user));
        set({ token, user, isAuthenticated: true, refreshPending: null, initialized: true });
      })
      .catch(() => {
        localStorage.removeItem('user');
        set({ token: null, user: null, isAuthenticated: false, refreshPending: null, initialized: true });
        throw new Error('refresh failed');
      });
    set({ refreshPending: promise });
    return promise;
  },

  loadFromStorage: () => {
    const userStr = localStorage.getItem('user');
    if (userStr) set({ user: JSON.parse(userStr) });
  },

  hasPermission: (resource: string, action: string): boolean => {
    const user = get().user;
    if (!user?.permissions) return false;
    const allowed = user.permissions[resource];
    return Array.isArray(allowed) && allowed.includes(action);
  },
}));

// 暴露 store 到 window
(useAuthStore as any).subscribe((state: any) => {
  (window as any).__authStore = { token: state.token, user: state.user, isAuthenticated: state.isAuthenticated };
  (window as any).__authSetState = useAuthStore.setState;
});

// 便捷导出
export function usePermission(resource: string, action: string): boolean {
  return useAuthStore((s) => s.hasPermission(resource, action));
}
