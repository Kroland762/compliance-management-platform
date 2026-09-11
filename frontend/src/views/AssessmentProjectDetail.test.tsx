import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';
import AssessmentProjectDetail from './AssessmentProjectDetail';

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
}));
vi.mock('./Findings', () => ({ default: () => <div>不符合项列表</div> }));
vi.mock('../components/lookups', () => ({
  AuditorSelect: ({ value }: { value?: string[] }) => <div data-testid="auditor-select">{value?.join(',')}</div>,
}));

const project = {
  id: 'task-1',
  name: '年度隐私评估',
  assessmentTarget: '核心业务系统',
  status: 'in_progress',
  template: { name: 'GDPR 模板' },
  auditors: [{ auditorUserId: 'auditor-1', auditor: { username: '审计员甲' } }],
  progress: { reviewed: 2, total: 10, findings: 1 },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/assessments/task-1']}>
      <Routes>
        <Route path="/assessments/:id" element={<AssessmentProjectDetail />} />
        <Route path="/assessments" element={<div>项目列表页</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AssessmentProjectDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false, media: query,
        addListener: vi.fn(), removeListener: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
      })),
    });
    useAuthStore.setState({
      user: {
        id: 'user-1', username: 'auditor', email: null, role: '审计员', roleIds: [],
        permissions: { tasks: ['read', 'update'] }, permissionScopes: {}, departmentIds: [],
        mustChangePassword: false, isGlobalAdmin: false,
      },
    });
  });

  it('shows a loading skeleton while the main project request is pending', async () => {
    let resolveProject!: (value: any) => void;
    vi.mocked(apiClient.get).mockImplementation((url) => {
      if (url === '/tasks/task-1') return new Promise((resolve) => { resolveProject = resolve; }) as any;
      return Promise.resolve({ data: { items: [] } }) as any;
    });

    renderPage();

    expect(document.querySelector('.ant-skeleton')).toBeInTheDocument();
    resolveProject({ data: project });
    expect(await screen.findByRole('heading', { name: '年度隐私评估' })).toBeInTheDocument();
  });

  it('shows a recoverable error page when the project request fails', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.get).mockImplementation(async (url) => {
      if (url === '/tasks/task-1' && vi.mocked(apiClient.get).mock.calls.filter(([calledUrl]) => calledUrl === url).length === 1) {
        throw new Error('项目请求失败');
      }
      if (url === '/tasks/task-1') return { data: project } as any;
      return { data: { items: [] } } as any;
    });

    renderPage();

    expect(await screen.findByText('无法加载评估项目')).toBeInTheDocument();
    expect(screen.getByText('项目请求失败')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '评估项目' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByRole('heading', { name: '年度隐私评估' })).toBeInTheDocument();
  });

  it('keeps the main project visible and warns when secondary data fails', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url) => {
      if (url === '/tasks/task-1') return { data: project } as any;
      if (url === '/tasks/task-1/assets') throw new Error('范围请求失败');
      return { data: { items: [] } } as any;
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: '年度隐私评估' })).toBeInTheDocument();
    expect(await screen.findByText('部分信息加载失败')).toBeInTheDocument();
    expect(screen.getByText(/未能加载：评估范围/)).toBeInTheDocument();
    expect(screen.getByTestId('auditor-select')).toHaveTextContent('auditor-1');
  });

  it('provides a direct route back to the project list', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.get).mockImplementation(async (url) => (
      url === '/tasks/task-1' ? { data: project } as any : { data: { items: [] } } as any
    ));

    renderPage();
    await screen.findByRole('heading', { name: '年度隐私评估' });
    await user.click(screen.getByRole('button', { name: '返回项目列表' }));
    expect(await screen.findByText('项目列表页')).toBeInTheDocument();
  });
});
