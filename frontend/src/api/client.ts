import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';

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
  try {
    const setState = (window as any).__authSetState;
    if (setState) setState({ token: null, user: null, isAuthenticated: false, refreshPending: null });
  } catch {}
};

const updateAuthState = (token: string, user: unknown) => {
  localStorage.setItem('user', JSON.stringify(user));
  try {
    const setState = (window as any).__authSetState;
    if (setState) setState({ token, user, isAuthenticated: true });
  } catch {}
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
  try {
    const store = (window as any).__authStore;
    if (store?.token) config.headers.Authorization = `Bearer ${store.token}`;
  } catch {}
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

    return Promise.reject(error.response?.data || error);
  },
);

export default apiClient;
