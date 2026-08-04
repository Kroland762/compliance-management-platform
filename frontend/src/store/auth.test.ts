import { beforeEach, describe, expect, it, vi } from 'vitest';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

vi.stubGlobal('localStorage', memoryStorage());
vi.stubGlobal('sessionStorage', memoryStorage());

const apiMock = vi.hoisted(() => ({
  post: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../api/client', () => ({ default: apiMock }));

import { useAuthStore } from './auth';

describe('tenant session state', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useAuthStore.setState({
      user: null,
      token: null,
      contexts: [],
      selectedTenant: null,
      isAuthenticated: false,
      initialized: true,
      refreshPending: null,
    });
  });

  it('persists selected tenant only in sessionStorage', () => {
    apiMock.post.mockResolvedValueOnce({
      data: {
        token: 'tenant-token',
        status: 'authenticated',
        contexts: [{ id: 'tenant-a', name: '租户甲', slug: 'tenant-a' }],
        user: {
          id: 'user-a',
          username: 'alice',
          email: null,
          tenantId: 'tenant-a',
          role: '审计员',
          roleIds: ['role-a'],
          permissions: {},
          permissionScopes: {},
          departmentIds: ['dept-a'],
          primaryDepartmentId: 'dept-a',
          mustChangePassword: false,
          isGlobalAdmin: false,
        },
      },
    });
    return useAuthStore.getState().selectContext('tenant-a').then(() => {
    expect(sessionStorage.getItem('selectedTenant')).toContain('tenant-a');
    expect(localStorage.getItem('selectedTenant')).toBeNull();
    });
  });

  it('clears selected tenant on logout', async () => {
    sessionStorage.setItem('selectedTenant', JSON.stringify({
      version: 2,
      tenant: { id: 'tenant-a', name: '租户甲', slug: 'tenant-a' },
    }));
    useAuthStore.setState({
      selectedTenant: { id: 'tenant-a', name: '租户甲', slug: 'tenant-a' },
      isAuthenticated: true,
    });
    apiMock.post.mockResolvedValueOnce({});
    await useAuthStore.getState().logout();
    expect(sessionStorage.getItem('selectedTenant')).toBeNull();
    expect(useAuthStore.getState().selectedTenant).toBeNull();
  });

  it('keeps an identity session tenant-free when tenant selection is required', async () => {
    apiMock.post.mockResolvedValueOnce({
      data: {
        token: 'identity-token',
        status: 'tenant_selection_required',
        contexts: [
          { id: 'tenant-a', name: '租户甲', slug: 'tenant-a' },
          { id: 'tenant-b', name: '租户乙', slug: 'tenant-b' },
        ],
        user: {
          id: 'user-a',
          username: 'alice',
          email: null,
          role: 'identity',
          roleIds: [],
          permissions: {},
          permissionScopes: {},
          departmentIds: [],
          mustChangePassword: false,
          isGlobalAdmin: false,
        },
      },
    });
    const status = await useAuthStore.getState().login('alice', 'secret');
    expect(status).toBe('tenant_selection_required');
    expect(useAuthStore.getState().contexts).toHaveLength(2);
    expect(useAuthStore.getState().selectedTenant).toBeNull();
    expect(sessionStorage.getItem('selectedTenant')).toBeNull();
  });

  it('surfaces forced password change before a tenant context is selected', async () => {
    apiMock.post.mockResolvedValueOnce({
      data: {
        token: 'temporary-token',
        status: 'password_change_required',
        contexts: [{ id: 'tenant-a', name: '租户甲', slug: 'tenant-a' }],
        user: {
          id: 'user-a',
          username: 'alice',
          email: null,
          role: 'identity',
          roleIds: [],
          permissions: {},
          permissionScopes: {},
          departmentIds: [],
          mustChangePassword: true,
          isGlobalAdmin: false,
        },
      },
    });
    const status = await useAuthStore.getState().login('alice', 'temporary');
    expect(status).toBe('password_change_required');
    expect(useAuthStore.getState().user?.mustChangePassword).toBe(true);
    expect(useAuthStore.getState().selectedTenant).toBeNull();
  });
});
