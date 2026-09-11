import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { message } from 'antd';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RiskForm from './RiskForm';
import { riskApi } from '../api/risks';
import { useAuthStore } from '../store/auth';

vi.mock('../api/risks', () => ({ riskApi: { create: vi.fn(), detail: vi.fn(), update: vi.fn(), assignReviewer: vi.fn() } }));
vi.mock('../components/lookups', () => ({
  DepartmentSelect: () => <input aria-label="责任部门选择" />,
  PersonnelSelect: ({ placeholder, value, onChange }: any) => <input aria-label={placeholder || '人员选择'} value={value || ''} onChange={(event) => onChange?.(event.target.value)} />,
  LookupSelect: () => <input aria-label="资产选择" />,
}));

const savedRisk = {
  id: 'risk-1', creationMode: 'manual', status: 'pending_confirmation', lockVersion: 4,
  title: '运维风险', description: '运维工单抽查发现共享账号权限过大', createdBy: 'creator-1',
  discoverySource: 'daily_operations', discoverySourceDetail: '月度运维抽查', sourceReference: 'OPS-001',
  riskLevel: 'high', treatmentStrategy: 'mitigate', ownerDepartmentId: 'dept-1', ownerUserId: 'owner-1',
  reviewerUserId: 'reviewer-1', reviewer: { displayName: '审核人乙' }, dueDate: '2026-09-30',
  affectedAssets: [{ assetId: 'asset-1', impactLevel: 'high', impactDescription: '影响访问控制' }],
};

async function editRisk() {
  render(<MemoryRouter initialEntries={['/risks/risk-1/edit']}><Routes>
    <Route path="/risks/:id/edit" element={<RiskForm />} />
    <Route path="/risks/:id" element={<div>风险详情</div>} />
  </Routes></MemoryRouter>);
  await screen.findByRole('heading', { name: '编辑风险' });
}

describe('RiskForm', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(riskApi.detail).mockResolvedValue({ data: savedRisk } as any);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query,
        addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })),
    });
    useAuthStore.setState({
      user: { id: 'creator-1', username: 'creator', email: null, role: '管理员', roleIds: [],
        permissions: { risks: ['create', 'update', 'assign'] }, permissionScopes: {}, departmentIds: [],
        mustChangePassword: false, isGlobalAdmin: false },
    });
  });

  it('defaults an independent risk to daily operations and requires source, reviewer and affected assets', () => {
    render(<MemoryRouter initialEntries={['/risks/new']}><Routes><Route path="/risks/new" element={<RiskForm />} /></Routes></MemoryRouter>);
    expect(screen.getByRole('heading', { name: '新增独立风险' })).toBeInTheDocument();
    expect(screen.getByText('日常运维')).toBeInTheDocument();
    expect(screen.getByText('来源说明')).toBeInTheDocument();
    expect(screen.getByLabelText('输入具备确认/验证权限的人员姓名')).toBeInTheDocument();
    expect(screen.getByLabelText('资产选择')).toBeInTheDocument();
  });

  it('编辑时使用乐观锁，冲突后保留表单并显示明确提示', async () => {
    const user = userEvent.setup();
    vi.mocked(riskApi.detail).mockResolvedValue({ data: {
      id: 'risk-1', creationMode: 'manual', status: 'pending_confirmation', lockVersion: 4,
      title: '运维风险', description: '运维工单抽查发现共享账号权限过大',
      discoverySource: 'daily_operations', discoverySourceDetail: '月度运维抽查', sourceReference: 'OPS-001',
      riskLevel: 'high', treatmentStrategy: 'mitigate', ownerDepartmentId: 'dept-1', ownerUserId: 'owner-1',
      reviewerUserId: 'reviewer-1', reviewer: { displayName: '审核人乙' }, dueDate: '2026-09-30',
      affectedAssets: [{ assetId: 'asset-1', impactLevel: 'high', impactDescription: '影响访问控制' }],
    } } as any);
    vi.mocked(riskApi.update).mockRejectedValue({ error: { code: 'CONFLICT' } });
    const errorSpy = vi.spyOn(message, 'error').mockImplementation(() => ({}) as any);

    render(<MemoryRouter initialEntries={['/risks/risk-1/edit']}><Routes>
      <Route path="/risks/:id/edit" element={<RiskForm />} />
    </Routes></MemoryRouter>);

    await screen.findByRole('heading', { name: '编辑风险' });
    await user.click(screen.getByRole('button', { name: /保存修改/ }));
    await waitFor(() => expect(riskApi.update).toHaveBeenCalledWith('risk-1', expect.any(Object), 4));
    expect(errorSpy).toHaveBeenCalledWith('风险已被其他人修改，请刷新后重试');
    expect(screen.getByDisplayValue('运维风险')).toBeInTheDocument();
  });

  it('评估风险可保存资料，来源只读且不提交人工字段', async () => {
    const user = userEvent.setup();
    vi.mocked(riskApi.detail).mockResolvedValue({ data: { ...savedRisk, creationMode: 'evaluation',
      discoverySource: 'compliance_assessment', discoverySourceDetail: null, sourceReference: null,
      reviewerUserId: null, reviewer: null } } as any);
    vi.mocked(riskApi.update).mockResolvedValue({ data: { ...savedRisk, lockVersion: 5 } } as any);
    await editRisk();
    expect(screen.getByText('合规评估（只读）')).toBeInTheDocument();
    expect(screen.queryByLabelText('来源说明')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /分配审核人/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /保存修改/ }));
    await screen.findByText('风险详情');
    const payload = vi.mocked(riskApi.update).mock.calls[0][1] as any;
    expect(payload).toMatchObject({ title: savedRisk.title, assets: [{ assetId: 'asset-1' }] });
    for (const field of ['discoverySource', 'discoverySourceDetail', 'sourceReference', 'reviewerUserId', 'creationMode']) {
      expect(payload).not.toHaveProperty(field);
    }
    expect(riskApi.assignReviewer).not.toHaveBeenCalled();
  });

  it('分配失败不提交资料，修正后可用同一版本重试，随后资料保存使用新版本', async () => {
    const user = userEvent.setup();
    vi.mocked(riskApi.assignReviewer)
      .mockRejectedValueOnce({ error: { code: 'VALIDATION_ERROR', message: '所选审核人权限已被撤销' } })
      .mockResolvedValueOnce({ data: { ...savedRisk, reviewerUserId: 'reviewer-3',
        reviewer: { displayName: '审核人丙' }, lockVersion: 5 } } as any);
    vi.mocked(riskApi.update).mockResolvedValue({ data: { ...savedRisk, lockVersion: 6 } } as any);
    await editRisk();
    const title = screen.getByLabelText('标题');
    await user.clear(title);
    await user.type(title, '尚未保存的风险资料');
    const reviewer = screen.getByLabelText('输入具备确认/验证权限的人员姓名');
    await user.clear(reviewer);
    await user.type(reviewer, 'reviewer-2');
    await user.click(screen.getByRole('button', { name: /分配审核人/ }));
    await screen.findByText('所选审核人权限已被撤销');
    expect(riskApi.update).not.toHaveBeenCalled();
    expect(reviewer).toHaveValue('reviewer-2');
    await user.clear(reviewer);
    await user.type(reviewer, 'reviewer-3');
    await user.click(screen.getByRole('button', { name: /分配审核人/ }));
    await screen.findByText('当前审核人：审核人丙');
    expect(riskApi.assignReviewer).toHaveBeenNthCalledWith(1, 'risk-1', 'reviewer-2', 4);
    expect(riskApi.assignReviewer).toHaveBeenNthCalledWith(2, 'risk-1', 'reviewer-3', 4);
    expect(title).toHaveValue('尚未保存的风险资料');
    await user.click(screen.getByRole('button', { name: /保存修改/ }));
    await screen.findByText('风险详情');
    expect(riskApi.update).toHaveBeenCalledWith('risk-1', expect.objectContaining({ title: '尚未保存的风险资料' }), 5);
    expect(vi.mocked(riskApi.update).mock.calls[0][1]).not.toHaveProperty('reviewerUserId');
  });

  it('未保存或无效的审核人选择不阻止独立保存风险资料', async () => {
    const user = userEvent.setup();
    vi.mocked(riskApi.update).mockResolvedValue({ data: { ...savedRisk, lockVersion: 5 } } as any);
    await editRisk();
    await user.clear(screen.getByLabelText('输入具备确认/验证权限的人员姓名'));
    await user.click(screen.getByRole('button', { name: /保存修改/ }));
    await screen.findByText('风险详情');
    expect(riskApi.update).toHaveBeenCalledWith('risk-1', expect.any(Object), 4);
    expect(riskApi.assignReviewer).not.toHaveBeenCalled();
  });

  it('无分配权限只能查看当前审核人', async () => {
    useAuthStore.setState({ user: { ...useAuthStore.getState().user!, permissions: { risks: ['read', 'update'] } } });
    await editRisk();
    expect(screen.getByText('当前审核人：审核人乙')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /分配审核人/ })).not.toBeInTheDocument();
  });

  it.each(['creator-1', 'owner-1'])('阻止将 %s 指定为独立审核人', async (invalidReviewer) => {
    const user = userEvent.setup();
    await editRisk();
    const reviewer = screen.getByLabelText('输入具备确认/验证权限的人员姓名');
    await user.clear(reviewer);
    await user.type(reviewer, invalidReviewer);
    await user.click(screen.getByRole('button', { name: /分配审核人/ }));
    await screen.findByText('审核人不能是创建人或当前负责人');
    expect(riskApi.assignReviewer).not.toHaveBeenCalled();
  });
});
