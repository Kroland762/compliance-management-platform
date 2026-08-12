import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';
import MainLayout from './MainLayout';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock('../hooks/useIdleTimeout', () => ({ default: vi.fn() }));
vi.mock('../views/Profile', () => ({ default: () => null }));

describe('MainLayout platform mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        id: 'global-admin',
        username: 'admin',
        email: null,
        role: '管理员',
        roleIds: ['global-admin-role'],
        permissions: {
          tenants: ['create', 'read', 'update', 'delete'],
          users: ['read'],
          dashboard: ['read'],
          account_dashboard: ['read'],
          organization: ['read'],
          audit_logs: ['read'],
        },
        permissionScopes: {},
        departmentIds: [],
        mustChangePassword: false,
        isGlobalAdmin: true,
      },
      token: 'control-token',
      contexts: [{ id: 'tenant-1', name: '租户一', slug: 'tenant-1' }],
      isAuthenticated: true,
      initialized: true,
      refreshPending: null,
      selectedTenant: null,
    });
  });

  it('only renders platform-level navigation without tenant business entries', () => {
    render(
      <MemoryRouter initialEntries={['/tenants']}>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route path="tenants" element={<div>租户管理内容</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: '平台管理' })).toBeInTheDocument();
    expect(screen.getByText('租户管理')).toBeInTheDocument();
    expect(screen.getByText('租户管理内容')).toBeInTheDocument();
    expect(screen.queryByText('资质合规')).not.toBeInTheDocument();
    expect(screen.queryByText('账户审计')).not.toBeInTheDocument();
    expect(screen.queryByText('产品合规')).not.toBeInTheDocument();
    expect(screen.queryByText('角色管理')).not.toBeInTheDocument();
    expect(screen.queryByText('成员管理')).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('shows product compliance as a tenant-only top-level module with permission-scoped entries', async () => {
    useAuthStore.setState({
      user: {
        id: 'compliance-1', username: 'compliance', email: null, role: '合规人员', roleIds: ['role-1'],
        permissions: { products: ['read'], product_dossiers: ['read', 'review', 'confirm'], product_compliance_config: ['read'] },
        permissionScopes: {}, departmentIds: ['department-1'], mustChangePassword: false, isGlobalAdmin: false,
      },
      selectedTenant: { id: 'tenant-1', name: '租户一', slug: 'tenant-1' },
      contexts: [{ id: 'tenant-1', name: '租户一', slug: 'tenant-1' }],
    });
    render(
      <MemoryRouter initialEntries={['/product-compliance/products']}>
        <Routes><Route path="/" element={<MainLayout />}><Route path="product-compliance/products" element={<div>产品内容</div>} /></Route></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: '产品合规' })).toBeInTheDocument();
    expect(screen.getByText('产品台账')).toBeInTheDocument();
    expect(screen.getByText('待复核')).toBeInTheDocument();
    expect(screen.getByText('配置管理')).toBeInTheDocument();
    expect(screen.getByText('产品内容')).toBeInTheDocument();
  });

  it('hides tenant governance navigation that the current role cannot read', async () => {
    useAuthStore.setState({
      user: {
        id: 'auditor-1',
        username: 'auditor',
        email: null,
        role: '审计员',
        roleIds: ['auditor-role'],
        permissions: {
          users: ['read'],
          dashboard: ['read'],
          tasks: ['read'],
        },
        permissionScopes: {},
        departmentIds: ['department-1'],
        mustChangePassword: false,
        isGlobalAdmin: false,
      },
      selectedTenant: { id: 'tenant-1', name: '租户一', slug: 'tenant-1' },
      contexts: [{ id: 'tenant-1', name: '租户一', slug: 'tenant-1' }],
    });

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route path="settings" element={<div>个人设置内容</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('安全设置')).toBeInTheDocument();
    expect(screen.queryByText('组织管理')).not.toBeInTheDocument();
    expect(screen.queryByText('操作日志')).not.toBeInTheDocument();
  });

  it('shows the assessment workflow to auditors without baseline ledgers or create entry', async () => {
    useAuthStore.setState({
      user: {
        id: 'auditor-1', username: 'auditor', email: null, role: '审计员', roleIds: ['auditor-role'],
        permissions: {
          dashboard: ['read'], tasks: ['read'], evaluations: ['read', 'claim', 'review'],
          findings: ['read', 'remediate', 'escalate', 'verify'], risks: ['read'], remediation_actions: ['read', 'verify'],
        },
        permissionScopes: {}, departmentIds: ['department-1'], mustChangePassword: false, isGlobalAdmin: false,
      },
      selectedTenant: { id: 'tenant-1', name: '租户一', slug: 'tenant-1' },
      contexts: [{ id: 'tenant-1', name: '租户一', slug: 'tenant-1' }],
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes><Route path="/" element={<MainLayout />}><Route path="dashboard" element={<div>工作台内容</div>} /></Route></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: '合规评估' })).toBeInTheDocument();
    expect(screen.getByText('评估项目')).toBeInTheDocument();
    expect(screen.getByText('我的待办')).toBeInTheDocument();
    expect(screen.getByText('不符合项')).toBeInTheDocument();
    expect(screen.getByText('风险与整改')).toBeInTheDocument();
    expect(screen.queryByText('合规标准')).not.toBeInTheDocument();
    expect(screen.queryByText('资产台账')).not.toBeInTheDocument();
    expect(screen.queryByText('资质台账')).not.toBeInTheDocument();
    expect(screen.queryByText('创建评估')).not.toBeInTheDocument();
  });

  it('uses the available viewport width for the assessment workbench only', () => {
    useAuthStore.setState({
      user: {
        id: 'auditor-1', username: 'auditor', email: null, role: '审计员', roleIds: ['auditor-role'],
        permissions: { tasks: ['read'], evaluations: ['read'] }, permissionScopes: {},
        departmentIds: ['department-1'], mustChangePassword: false, isGlobalAdmin: false,
      },
      selectedTenant: { id: 'tenant-1', name: '租户一', slug: 'tenant-1' },
      contexts: [{ id: 'tenant-1', name: '租户一', slug: 'tenant-1' }],
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/assessments/task-1/workbench']}>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route path="assessments/:id/workbench" element={<div>评估表内容</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(container.querySelector<HTMLElement>('.app-content')).toHaveStyle({ maxWidth: 'none' });
    expect(screen.getByText('评估表内容')).toBeInTheDocument();
  });
});
