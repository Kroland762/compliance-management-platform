import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { useAuthStore } from '../../store/auth';
import DossierDetail, { buildSubmissionChecklist } from './DossierDetail';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

vi.mock('../../components/lookups', () => ({ LookupSelect: () => null, SearchableSelect: () => null }));

const incompleteDossier = {
  id: 'dossier-1', revisionNumber: 1, lifecycleStatus: 'draft', complianceConclusion: 'not_assessed', proposedConclusion: 'not_assessed',
  permissionsDeclared: null, personalDataDeclared: true, platformPermissions: [], dataItems: [], processingActivities: [], lockVersion: 0,
  questionnaires: [{ id: 'assignment-1', templateSnapshot: { name: '隐私问卷', version: '1.0' }, answers: [{ id: 'answer-1', questionId: 'question-1', response: '', question: { title: '是否提供注销入口', required: true, questionType: 'boolean', sortOrder: 1 } }] }],
  productVersion: { id: 'version-1', productId: 'product-1', version: '1.0.0', platforms: ['Web'], usageScope: '公开服务', changeDeclaration: {}, product: { id: 'product-1', name: 'Web 产品' } },
};

describe('DossierDetail submission checklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })),
    });
    useAuthStore.setState({
      user: {
        id: 'owner-1', username: 'owner', email: null, role: '产品负责人', roleIds: [],
        permissions: { product_dossiers: ['read', 'update', 'submit'] }, permissionScopes: {}, departmentIds: [],
        mustChangePassword: false, isGlobalAdmin: false,
      },
    });
  });

  it('matches every backend submission failure condition and message', () => {
    const failures = buildSubmissionChecklist(incompleteDossier).filter((item) => !item.complete).map((item) => item.text);
    expect(failures).toEqual([
      '必答题未填写：是否提供注销入口',
      '请明确是否申请平台权限',
      '已声明处理个人数据，请至少填写一种信息类型',
      '已声明处理个人数据，请至少填写一项ROPA处理活动',
      '请填写拟定合规结论',
    ]);
  });

  it('treats false answers and explicit negative declarations as complete just like the backend', () => {
    const complete = {
      ...incompleteDossier,
      proposedConclusion: 'compliant', permissionsDeclared: false, personalDataDeclared: false,
      questionnaires: [{ ...incompleteDossier.questionnaires[0], answers: [{ ...incompleteDossier.questionnaires[0].answers[0], response: false }] }],
    };
    expect(buildSubmissionChecklist(complete).every((item) => item.complete)).toBe(true);
  });

  it('requires third-party review results when a third-party service is recorded', () => {
    const failures = buildSubmissionChecklist({
      ...incompleteDossier,
      thirdPartyServices: [{ serviceName: '云服务', assessmentPassed: null }],
      thirdPartyAssessments: [],
    }).filter((item) => !item.complete).map((item) => item.text);
    expect(failures).toContain('第三方清单需明确是否通过第三方评审');
    expect(failures).toContain('已填写第三方清单，请至少保留一份第三方安全评审记录');
  });

  it('shows the APP-specific questionnaire tab only when the APP template is assigned', async () => {
    const appDossier = {
      ...incompleteDossier,
      questionnaires: [
        incompleteDossier.questionnaires[0],
        { id: 'assignment-app', templateSnapshot: { seriesKey: 'app-compliance-checklist', name: 'APP 合规问卷', version: '1.0' }, answers: [] },
      ],
    };
    vi.mocked(apiClient.get).mockImplementation(async (url) => {
      if (url === '/product-compliance/dossiers/dossier-1') return { data: appDossier } as any;
      return { data: [] } as any;
    });

    render(<MemoryRouter initialEntries={['/product-compliance/dossiers/dossier-1']}><Routes><Route path="/product-compliance/dossiers/:id" element={<DossierDetail />} /></Routes></MemoryRouter>);

    expect(await screen.findByText('基础问卷')).toBeInTheDocument();
    expect(screen.getByText('APP专项问卷')).toBeInTheDocument();
  });

  it('does not show the APP-specific questionnaire tab for SDK-style dossiers', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url) => {
      if (url === '/product-compliance/dossiers/dossier-1') return { data: incompleteDossier } as any;
      return { data: [] } as any;
    });

    render(<MemoryRouter initialEntries={['/product-compliance/dossiers/dossier-1']}><Routes><Route path="/product-compliance/dossiers/:id" element={<DossierDetail />} /></Routes></MemoryRouter>);

    expect(await screen.findByText('基础问卷')).toBeInTheDocument();
    expect(screen.queryByText('APP专项问卷')).not.toBeInTheDocument();
  });

  it('shows retry/back context and renders the saved-data checklist after recovery', async () => {
    const user = userEvent.setup();
    let dossierAttempts = 0;
    vi.mocked(apiClient.get).mockImplementation(async (url) => {
      if (url === '/product-compliance/dossiers/dossier-1') {
        dossierAttempts += 1;
        if (dossierAttempts === 1) throw { error: { message: '档案读取失败' } };
        return { data: incompleteDossier } as any;
      }
      return { data: {} } as any;
    });

    render(<MemoryRouter initialEntries={['/product-compliance/dossiers/dossier-1']}><Routes><Route path="/product-compliance/dossiers/:id" element={<DossierDetail />} /></Routes></MemoryRouter>);

    expect(await screen.findByText('无法加载合规档案')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回产品台账' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /重\s*试/ }));

    expect(await screen.findByText('提交前完整性检查')).toBeInTheDocument();
    expect(screen.getByText('还有 5 项未完成')).toBeInTheDocument();
    expect(screen.getByText('清单反映已保存的档案内容；修改后请先保存，再提交复核。')).toBeInTheDocument();
    expect(screen.getByText('必答题未填写：是否提供注销入口')).toBeInTheDocument();
    expect(screen.getByText('请明确是否申请平台权限')).toBeInTheDocument();
    expect(screen.getByText('已声明处理个人数据，请至少填写一种信息类型')).toBeInTheDocument();
    expect(screen.getByText('已声明处理个人数据，请至少填写一项ROPA处理活动')).toBeInTheDocument();
    expect(screen.getByText('请填写拟定合规结论')).toBeInTheDocument();
    await waitFor(() => expect(dossierAttempts).toBe(2));
  });
});
