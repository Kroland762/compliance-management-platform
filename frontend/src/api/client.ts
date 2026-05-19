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

let refreshPromise: Promise<any> | null = null;

const refreshToken = async (): Promise<any> => {
  if (refreshPromise) return refreshPromise;
  refreshPromise = apiClient.post('/auth/refresh', {}, { _skipRefresh: true })
    .then(res => { refreshPromise = null; return res; })
    .catch(err => { refreshPromise = null; throw err; });
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
let isRefreshing = false;

apiClient.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    if (originalRequest._skipRefresh) {
      return Promise.reject(error.response?.data || error);
    }

    if (error.response?.status === 401 && !originalRequest._retry && !isRefreshing) {
      isRefreshing = true;
      try {
        const res = await refreshToken();
        const { token, user } = res.data;
        try {
          const setState = (window as any).__authSetState;
          if (setState) setState({ token, user, isAuthenticated: true });
        } catch {}
        localStorage.setItem('user', JSON.stringify(user));
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${token}`;
        originalRequest._retry = true;
        isRefreshing = false;
        return apiClient(originalRequest);
      } catch {
        isRefreshing = false;
        localStorage.removeItem('user');
        try {
          const store = (window as any).__authStore;
          if (store?.setState) store.setState({ token: null, user: null, isAuthenticated: false });
        } catch {}
        window.location.replace('/login');
        return Promise.reject(error.response?.data || error);
      }
    }

    return Promise.reject(error.response?.data || error);
  },
);

export default apiClient;
