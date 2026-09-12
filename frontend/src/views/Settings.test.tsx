import { App as AntApp } from 'antd';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';
import Settings from './Settings';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

function setPermissions(permissions: Record<string, string[]>) {
  useAuthStore.setState({
    user: {
      id: 'member-1',
      username: 'member',
      email: null,
      role: '审计员',
      roleIds: ['auditor-role'],
      permissions,
      permissionScopes: {},
      departmentIds: [],
      mustChangePassword: false,
      isGlobalAdmin: false,
    },
  });
}

describe('Settings visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('keeps personal password management but hides tenant security policies without permission', () => {
    setPermissions({ dashboard: ['read'] });

    render(<AntApp><Settings /></AntApp>);

    expect(screen.getAllByText('修改密码')).not.toHaveLength(0);
    expect(screen.queryByText('登录锁定策略')).not.toBeInTheDocument();
    expect(screen.queryByText('审计日志保留策略')).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('shows and loads tenant security policies with settings read permission', async () => {
    setPermissions({ settings: ['read'] });
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        maxLoginAttempts: 5,
        lockDurationMinutes: 15,
        idleTimeoutMinutes: 180,
        auditLogRetentionDays: 365,
      },
    } as any);

    render(<AntApp><Settings /></AntApp>);

    expect(await screen.findByText('登录锁定策略')).toBeInTheDocument();
    expect(screen.getByText('审计日志保留策略')).toBeInTheDocument();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/settings/security'));
  });
});
