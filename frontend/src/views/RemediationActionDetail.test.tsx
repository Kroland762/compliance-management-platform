import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';
import RemediationActionDetail from './RemediationActionDetail';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const pendingAction = {
  id: 'action-1', code: 'ACT-001', title: '权限整改', description: '收回多余权限',
  status: 'pending_verification', lockVersion: 7, ownerUserId: 'owner-1',
  owner: { displayName: '负责人' }, ownerDepartment: { name: '运维部' },
  evidenceFiles: [], findingLinks: [],
  riskLinks: [{ riskId: 'risk-1', risk: { code: 'RISK-001', title: '权限风险' },
    contributionDescription: '降低权限风险', verificationStatus: 'pending' }],
};

function mount() {
  render(<MemoryRouter initialEntries={['/remediation-actions/action-1']}><Routes>
    <Route path="/remediation-actions/:id" element={<RemediationActionDetail />} />
  </Routes></MemoryRouter>);
}

describe('risk remediation verification authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((media: string) => ({ matches: false, media,
        addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(),
        removeEventListener: vi.fn(), dispatchEvent: vi.fn() })),
    });
    vi.mocked(apiClient.get).mockResolvedValue({ data: pendingAction } as any);
    vi.mocked(apiClient.post).mockResolvedValue({ data: {} } as any);
    useAuthStore.setState({ user: {
      id: 'reviewer-1', username: 'reviewer', email: null, role: '审核人', roleIds: [],
      permissions: {}, permissionScopes: {}, departmentIds: [],
      mustChangePassword: false, isGlobalAdmin: false,
    } });
  });

  it.each(['risks', 'remediation_actions'] as const)('具备 %s.verify 可从页面验证，携带实际关联与版本', async (resource) => {
    useAuthStore.setState({ user: { ...useAuthStore.getState().user!,
      permissions: { [resource]: ['read', 'verify'] } } });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /^验\s*证$/ }));
    const dialog = screen.getByRole('dialog', { name: '整改验证' });
    await user.type(within(dialog).getByPlaceholderText('复核意见'), '证据符合要求');
    await user.click(within(dialog).getByRole('button', { name: /^通\s*过$/ }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/risks/risk-1/actions/action-1/verify', { decision: 'approved', comment: '证据符合要求' },
      { headers: { 'If-Match': '"7"' } },
    ));
  });

  it('只有读取权限不显示验证入口', async () => {
    useAuthStore.setState({ user: { ...useAuthStore.getState().user!,
      permissions: { risks: ['read'], remediation_actions: ['read'] } } });
    mount();
    await screen.findByText('RISK-001 · 权限风险');
    expect(screen.queryByRole('button', { name: /^验\s*证$/ })).not.toBeInTheDocument();
  });
});
