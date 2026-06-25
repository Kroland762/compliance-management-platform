import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { useAuthStore } from './auth';

vi.mock('../api/client', () => ({
  default: {
    post: vi.fn(),
  },
}));

const user = {
  id: 'user-1',
  username: 'tester',
  role: 'admin',
  roleId: 'role-1',
  permissions: { users: ['read', 'update'] },
  department: null,
  email: null,
};

describe('useAuthStore', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      initialized: false,
      refreshPending: null,
    });
  });

  it('登录后保存用户和认证状态', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { token: 'token-1', user } });

    await useAuthStore.getState().login('tester', 'secret');

    expect(useAuthStore.getState()).toMatchObject({ token: 'token-1', user, isAuthenticated: true });
    expect(JSON.parse(localStorage.getItem('user') || 'null')).toEqual(user);
  });

  it('退出接口失败时仍清理本地认证状态', async () => {
    useAuthStore.setState({ token: 'token-1', user, isAuthenticated: true });
    localStorage.setItem('user', JSON.stringify(user));
    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('network error'));

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState()).toMatchObject({ token: null, user: null, isAuthenticated: false });
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('严格按照资源和操作判断权限', () => {
    useAuthStore.setState({ user });
    expect(useAuthStore.getState().hasPermission('users', 'read')).toBe(true);
    expect(useAuthStore.getState().hasPermission('users', 'delete')).toBe(false);
    expect(useAuthStore.getState().hasPermission('roles', 'read')).toBe(false);
  });
});
