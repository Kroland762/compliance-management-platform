import { create } from 'zustand';
import apiClient from '../api/client';
import { registerAuthBridge } from './authBridge';

export interface TenantContext {
  id: string;
  name: string;
  slug: string;
  memberId?: string;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  memberId?: string;
  tenantId?: string;
  role: string;
  roleIds: string[];
  permissions: Record<string, string[]>;
  permissionScopes: Record<string, Record<string, string>>;
  primaryDepartmentId?: string;
  primaryDepartmentName?: string;
  departmentIds: string[];
  mustChangePassword: boolean;
  isGlobalAdmin: boolean;
}

export type LoginStatus = 'authenticated' | 'tenant_selection_required' | 'password_change_required';

interface AuthPayload {
  token: string;
  user: AuthUser;
  status: LoginStatus;
  contexts: TenantContext[];
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  contexts: TenantContext[];
  isAuthenticated: boolean;
  initialized: boolean;
  refreshPending: Promise<void> | null;
  selectedTenant: TenantContext | null;
  login: (username: string, password: string, captchaId?: string, captchaCode?: string) => Promise<LoginStatus>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  loadFromStorage: () => void;
  hasPermission: (resource: string, action: string) => boolean;
  selectContext: (tenantId: string) => Promise<void>;
  clearContext: () => Promise<void>;
}

const TENANT_SESSION_KEY = 'selectedTenant';

function readSelectedTenant(): TenantContext | null {
  try {
    const raw = sessionStorage.getItem(TENANT_SESSION_KEY);
    if (!raw) return null;
    const tenant = JSON.parse(raw)?.tenant;
    return typeof tenant?.id === 'string' && typeof tenant?.name === 'string' ? tenant : null;
  } catch {
    sessionStorage.removeItem(TENANT_SESSION_KEY);
    return null;
  }
}

function writeSelectedTenant(tenant: TenantContext | null): void {
  if (tenant) sessionStorage.setItem(TENANT_SESSION_KEY, JSON.stringify({ version: 2, tenant }));
  else sessionStorage.removeItem(TENANT_SESSION_KEY);
}

function persistPayload(payload: AuthPayload): { selectedTenant: TenantContext | null } {
  localStorage.setItem('user', JSON.stringify(payload.user));
  const selectedTenant = payload.user.tenantId
    ? payload.contexts.find((item) => item.id === payload.user.tenantId)
      || { id: payload.user.tenantId, name: '当前租户', slug: '' }
    : null;
  writeSelectedTenant(selectedTenant);
  return { selectedTenant };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  contexts: [],
  isAuthenticated: false,
  initialized: false,
  refreshPending: null,
  selectedTenant: null,

  login: async (username, password, captchaId, captchaCode) => {
    const response: any = await apiClient.post(
      '/auth/login',
      { username, password, captchaId, captchaCode },
      { _skipRefresh: true } as any,
    );
    const payload = response.data as AuthPayload;
    const { selectedTenant } = persistPayload(payload);
    set({
      token: payload.token,
      user: payload.user,
      contexts: payload.contexts || [],
      selectedTenant,
      isAuthenticated: true,
      initialized: true,
    });
    return payload.status;
  },

  logout: async () => {
    try { await apiClient.post('/auth/logout', {}, { _skipRefresh: true }); } catch {}
    localStorage.removeItem('user');
    writeSelectedTenant(null);
    set({
      token: null,
      user: null,
      contexts: [],
      selectedTenant: null,
      isAuthenticated: false,
      refreshPending: null,
      initialized: true,
    });
  },

  refreshToken: async () => {
    const pending = get().refreshPending;
    if (pending) return pending;
    const promise = apiClient.post('/auth/refresh', {}, { _skipRefresh: true })
      .then((response: any) => {
        const payload = response.data as AuthPayload;
        const { selectedTenant } = persistPayload(payload);
        set({
          token: payload.token,
          user: payload.user,
          contexts: payload.contexts || [],
          selectedTenant,
          isAuthenticated: true,
          refreshPending: null,
          initialized: true,
        });
      })
      .catch(() => {
        localStorage.removeItem('user');
        writeSelectedTenant(null);
        set({
          token: null,
          user: null,
          contexts: [],
          selectedTenant: null,
          isAuthenticated: false,
          refreshPending: null,
          initialized: true,
        });
        throw new Error('refresh failed');
      });
    set({ refreshPending: promise });
    return promise;
  },

  loadFromStorage: () => {
    const raw = localStorage.getItem('user');
    if (!raw) return;
    try {
      set({ user: JSON.parse(raw), selectedTenant: readSelectedTenant() });
    } catch {
      localStorage.removeItem('user');
      writeSelectedTenant(null);
    }
  },

  hasPermission: (resource, action) => {
    const allowed = get().user?.permissions?.[resource];
    return Array.isArray(allowed) && allowed.includes(action);
  },

  selectContext: async (tenantId) => {
    const response: any = await apiClient.post('/auth/context', { tenantId }, { _skipRefresh: true } as any);
    const payload = response.data as AuthPayload;
    const { selectedTenant } = persistPayload(payload);
    set({
      token: payload.token,
      user: payload.user,
      contexts: payload.contexts || [],
      selectedTenant,
      isAuthenticated: true,
    });
  },

  clearContext: async () => {
    const response: any = await apiClient.delete('/auth/context', { _skipRefresh: true } as any);
    const payload = response.data as AuthPayload;
    persistPayload(payload);
    set({
      token: payload.token,
      user: payload.user,
      contexts: payload.contexts || [],
      selectedTenant: null,
      isAuthenticated: true,
    });
  },
}));

registerAuthBridge(
  () => {
    const state = useAuthStore.getState();
    return { token: state.token, user: state.user, selectedTenant: state.selectedTenant };
  },
  useAuthStore.setState,
);

export function usePermission(resource: string, action: string): boolean {
  return useAuthStore((state) => state.hasPermission(resource, action));
}
