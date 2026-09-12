import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import { currentAuthSnapshot, patchAuthState } from '../store/authBridge';

declare module 'axios' {
  export interface AxiosRequestConfig {
    _skipRefresh?: boolean;
    _retry?: boolean;
  }
}

const apiClient = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

let refreshPromise: Promise<{ token: string; user: unknown }> | null = null;

const clearAuthState = () => {
  localStorage.removeItem('user');
  sessionStorage.removeItem('selectedTenant');
  patchAuthState({
    token: null,
    user: null,
    contexts: [],
    selectedTenant: null,
    isAuthenticated: false,
    refreshPending: null,
  });
};

const updateAuthState = (token: string, user: unknown) => {
  localStorage.setItem('user', JSON.stringify(user));
  patchAuthState({ token, user: user as any, isAuthenticated: true });
};

const refreshToken = async (): Promise<{ token: string; user: unknown }> => {
  if (!refreshPromise) {
    refreshPromise = apiClient.post('/auth/refresh', {}, { _skipRefresh: true })
      .then((res: any) => {
        const { token, user } = res.data;
        updateAuthState(token, user);
        return { token, user };
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
};

// 请求拦截器
apiClient.interceptors.request.use((config) => {
  const store = currentAuthSnapshot();
  if (store.token) config.headers.Authorization = `Bearer ${store.token}`;
  if (store.selectedTenant?.id) config.headers['X-Tenant-ID'] = store.selectedTenant.id;
  return config;
});

// 响应拦截器
apiClient.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    if (originalRequest?._skipRefresh) {
      return Promise.reject(error.response?.data || error);
    }

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const { token } = await refreshToken();
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return apiClient(originalRequest);
      } catch {
        clearAuthState();
        window.location.replace('/login');
        return Promise.reject(error.response?.data || error);
      }
    }

    const code = error.response?.data?.error?.code;
    if (code === 'PASSWORD_CHANGE_REQUIRED') {
      if (window.location.pathname !== '/change-password') window.location.replace('/change-password');
    }
    if (['TENANT_INACTIVE', 'TENANT_NOT_FOUND', 'MEMBERSHIP_INACTIVE'].includes(code)) {
      sessionStorage.removeItem('selectedTenant');
      patchAuthState({ selectedTenant: null });
      if (window.location.pathname !== '/tenant-select') window.location.replace('/tenant-select');
    }
    return Promise.reject(error.response?.data || error);
  },
);

export default apiClient;
