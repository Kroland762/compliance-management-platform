import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';
import RiskDetail from './RiskDetail';

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const baseRisk = {
  id: 'risk-1', code: 'RISK-001', title: '日常运维风险', description: '共享账号权限过大',
  status: 'pending_confirmation', lockVersion: 1, creationMode: 'manual', discoverySource: 'daily_operations',
  discoverySourceDetail: '运维工单抽查发现', sourceReference: 'OPS-001', riskLevel: 'high', treatmentStrategy: 'mitigate',
  ownerDepartment: { name: '信息安全部' }, owner: { displayName: '负责人甲' }, reviewer: { displayName: '审核人乙' },
  creator: { displayName: '创建人丙' }, affectedAssets: [], actionLinks: [], findingLinks: [], sources: [],
};

function setPermissions(permissions: Record<string, string[]>) {
  useAuthStore.setState({
    user: { id: 'user-1', username: 'auditor', email: null, role: '审计员', roleIds: [], permissions,
      permissionScopes: {}, departmentIds: [], mustChangePassword: false, isGlobalAdmin: false },
  });
}

function renderPage(risk = baseRisk) {
  vi.mocked(apiClient.get).mockResolvedValue({ data: risk } as any);
  return render(<MemoryRouter initialEntries={['/risks/risk-1']}><Routes>
    <Route path="/risks/:id" element={<RiskDetail />} />
  </Routes></MemoryRouter>);
}

describe('RiskDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({
      matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })) });
  });

  it('按人工来源展示说明与引用，待确认阶段只提供编辑、删除和确认', async () => {
    setPermissions({ risks: ['read', 'update', 'confirm', 'accept', 'close'], remediation_actions: ['create'] });
    renderPage();

    expect(await screen.findByText('独立风险来源')).toBeInTheDocument();
    expect(screen.getByText('运维工单抽查发现')).toBeInTheDocument();
    expect(screen.getByText('OPS-001')).toBeInTheDocument();
    expect(screen.queryByText(/来源不符合项/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /编\s*辑/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /删\s*除/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认风险' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '接受风险' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建整改行动' })).not.toBeInTheDocument();
  });

  it('已确认风险才能接受和创建整改，关闭按钮受行动门禁限制', async () => {
    setPermissions({ risks: ['read', 'update', 'confirm', 'accept', 'close'], remediation_actions: ['create'] });
    renderPage({
      ...baseRisk, status: 'remediating',
      actionLinks: [{ actionId: 'action-1', isRequired: true, verificationStatus: 'pending', action: { status: 'pending_verification' } }],
    });

    await screen.findByText('关闭门禁未满足');
    expect(screen.getByRole('button', { name: '接受风险' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建整改行动' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭风险' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /编\s*辑/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认风险' })).not.toBeInTheDocument();
  });
});
