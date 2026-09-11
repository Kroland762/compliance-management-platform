import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../store/auth';
import PrivateRoute from './PrivateRoute';

function CurrentPath() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

function renderRoute(permission?: [string, string], fallbackPath?: string) {
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route path="/protected" element={(
          <PrivateRoute permission={permission} fallbackPath={fallbackPath}>
            <div>受保护内容</div>
          </PrivateRoute>
        )} />
        <Route path="/login" element={<div>登录页</div>} />
        <Route path="/dashboard" element={<div>仪表盘</div>} />
        <Route path="/account-audit/data-sources" element={<div>数据源列表</div>} />
      </Routes>
      <CurrentPath />
    </MemoryRouter>,
  );
}

describe('PrivateRoute', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      initialized: false,
      refreshPending: null,
      contexts: [],
      selectedTenant: null,
    });
  });

  it('等待认证初始化完成', () => {
    renderRoute();
    expect(screen.getByText('正在加载账号信息')).toBeInTheDocument();
  });

  it('未登录时跳转到登录页', async () => {
    useAuthStore.setState({ initialized: true });
    renderRoute();
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/login'));
  });

  it('权限不足时说明原因并允许返回仪表盘', async () => {
    useAuthStore.setState({
      initialized: true,
      isAuthenticated: true,
      selectedTenant: { id: 'tenant-1', name: '测试租户', slug: 'test' },
      user: {
        id: 'user-1', username: 'tester', role: 'viewer', roleIds: ['role-1'],
        permissions: { users: ['read'] }, permissionScopes: {}, departmentIds: [],
        email: null, mustChangePassword: false, isGlobalAdmin: false,
      },
    });
    renderRoute(['users', 'delete']);
    expect(await screen.findByText('无权访问此页面')).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/protected');
    await userEvent.click(screen.getByRole('button', { name: '返回可访问页面' }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/dashboard'));
  });

  it('权限不足时可以主动返回指定业务模块', async () => {
    useAuthStore.setState({
      initialized: true,
      isAuthenticated: true,
      selectedTenant: { id: 'tenant-1', name: '测试租户', slug: 'test' },
      user: {
        id: 'user-1', username: 'auditor', role: '审计员', roleIds: ['role-1'],
        permissions: { data_sources: ['read'] }, permissionScopes: {}, departmentIds: [],
        email: null, mustChangePassword: false, isGlobalAdmin: false,
      },
    });
    renderRoute(['data_sources', 'create'], '/account-audit/data-sources');
    expect(await screen.findByText('无权访问此页面')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '返回可访问页面' }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/account-audit/data-sources'));
    expect(screen.getByText('数据源列表')).toBeInTheDocument();
  });

  it('已登录且具备权限时渲染内容', () => {
    useAuthStore.setState({
      initialized: true,
      isAuthenticated: true,
      selectedTenant: { id: 'tenant-1', name: '测试租户', slug: 'test' },
      user: {
        id: 'user-1', username: 'tester', role: 'admin', roleIds: ['role-1'],
        permissions: { users: ['read'] }, permissionScopes: {}, departmentIds: [],
        email: null, mustChangePassword: false, isGlobalAdmin: false,
      },
    });
    renderRoute(['users', 'read']);
    expect(screen.getByText('受保护内容')).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/protected');
  });
});
