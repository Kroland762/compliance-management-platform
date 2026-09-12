import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';
import RiskAndRemediation from './RiskAndRemediation';

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
vi.mock('../components/lookups', () => ({ DepartmentSelect: () => <div /> }));

function setRiskPermissions(actions: string[]) {
  useAuthStore.setState({
    user: { id: 'user-1', username: 'risk-user', email: null, role: '风险管理员', roleIds: [],
      permissions: { risks: actions }, permissionScopes: {}, departmentIds: [], mustChangePassword: false, isGlobalAdmin: false },
  });
}

function renderPage() {
  return render(<MemoryRouter initialEntries={['/governance']}><Routes>
    <Route path="/governance" element={<RiskAndRemediation />} />
  </Routes></MemoryRouter>);
}

describe('RiskAndRemediation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({
      matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })) });
    vi.mocked(apiClient.get).mockResolvedValue({ data: { items: [{
      id: 'risk-1', code: 'RISK-001', title: '运维风险', discoverySource: 'daily_operations', riskLevel: 'high',
      ownerDepartment: { name: '信息安全部' }, owner: { displayName: '王安全' }, status: 'open', dueDate: '2026-09-30',
    }], pagination: { total: 25 } } } as any);
  });

  it('只向具有创建权限的用户展示新增入口，并使用可访问的详情链接', async () => {
    setRiskPermissions(['read', 'create']);
    const { unmount } = renderPage();
    expect(await screen.findByRole('button', { name: /新增风险/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'RISK-001' })).toHaveAttribute('href', '/risks/risk-1');
    unmount();

    setRiskPermissions(['read']);
    renderPage();
    await screen.findByRole('link', { name: 'RISK-001' });
    expect(screen.queryByRole('button', { name: /新增风险/ })).not.toBeInTheDocument();
  });

  it('把发现来源筛选和分页参数发给服务端', async () => {
    const user = userEvent.setup();
    setRiskPermissions(['read']);
    renderPage();
    await screen.findByRole('link', { name: 'RISK-001' });
    expect(apiClient.get).toHaveBeenCalledWith('/risks', { params: { page: 1, pageSize: 20 } });

    fireEvent.mouseDown(screen.getByText('发现来源', { selector: '.ant-select-selection-placeholder' }).closest('.ant-select-selector')!);
    await user.click(await screen.findByText('日常运维', { selector: '.ant-select-item-option-content' }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/risks', {
      params: { discoverySource: 'daily_operations', page: 1, pageSize: 20 },
    }));

    await user.click(screen.getByTitle('2'));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/risks', {
      params: { discoverySource: 'daily_operations', page: 2, pageSize: 20 },
    }));
  });
});
