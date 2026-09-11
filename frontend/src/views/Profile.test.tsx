import { App as AntApp } from 'antd';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../store/auth';
import ProfileModal from './Profile';

vi.mock('../api/client', () => ({
  default: { put: vi.fn() },
}));

describe('ProfileModal', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    useAuthStore.setState({
      user: {
        id: 'user-1',
        username: 'auditor',
        email: null,
        role: '审计员',
        roleIds: ['role-1'],
        permissions: {},
        permissionScopes: {},
        primaryDepartmentId: '1f4dc94c-8c2d-43bd-96df-54de74d62980',
        primaryDepartmentName: '安全合规部',
        departmentIds: ['1f4dc94c-8c2d-43bd-96df-54de74d62980'],
        mustChangePassword: false,
        isGlobalAdmin: false,
      },
    });
  });

  it('shows the primary department name instead of its UUID', () => {
    render(<AntApp><ProfileModal open onClose={() => {}} /></AntApp>);

    expect(screen.getByText('安全合规部')).toBeInTheDocument();
    expect(screen.queryByText('1f4dc94c-8c2d-43bd-96df-54de74d62980')).not.toBeInTheDocument();
  });
});
