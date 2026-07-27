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

vi.mock('../api/client', () => ({
  default: { post: vi.fn().mockResolvedValue({ data: {} }) },
}));

import { useAuthStore } from './auth';

describe('tenant session state', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useAuthStore.setState({
      user: null,
      token: null,
      selectedTenant: null,
      isAuthenticated: false,
      initialized: true,
      refreshPending: null,
    });
  });

  it('persists selected tenant only in sessionStorage', () => {
    useAuthStore.getState().selectTenant({ id: 'tenant-a', name: '租户甲' });
    expect(sessionStorage.getItem('selectedTenant')).toContain('tenant-a');
    expect(localStorage.getItem('selectedTenant')).toBeNull();
  });

  it('clears selected tenant on logout', async () => {
    useAuthStore.getState().selectTenant({ id: 'tenant-a', name: '租户甲' });
    await useAuthStore.getState().logout();
    expect(sessionStorage.getItem('selectedTenant')).toBeNull();
    expect(useAuthStore.getState().selectedTenant).toBeNull();
  });
});
