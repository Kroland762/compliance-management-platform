import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { useAuthStore } from '../../store/auth';
import ReviewTaskList from './ReviewTaskList';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), delete: vi.fn() },
}));

const task = {
  id: 'task-1',
  name: '年度隐私评估',
  assessmentType: 'GDPR',
  assessmentTarget: '核心业务系统',
  status: 'in_progress',
  publishedAt: '2026-08-20T00:00:00Z',
  submittedAt: null,
  createdAt: '2026-08-19T00:00:00Z',
  creator: { username: '创建人甲' },
  assignee: { username: '责任人乙' },
  auditors: [{ auditor: { username: '审计员丙' } }],
  _stats: { answered: 3, total: 10 },
  _assignees: ['责任人乙'],
};

describe('ReviewTaskList', () => {
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
        id: 'user-1', username: 'reader', email: null, role: '审计员', roleIds: [],
        permissions: { tasks: ['read'] }, permissionScopes: {}, departmentIds: [],
        mustChangePassword: false, isGlobalAdmin: false,
      },
    });
  });

  it('separates a load failure from the business empty state and retries', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.get)
      .mockRejectedValueOnce(new Error('网络不可用'))
      .mockResolvedValueOnce({ data: { items: [task] } } as any);

    render(<MemoryRouter><ReviewTaskList /></MemoryRouter>);

    expect(await screen.findByText('评估项目加载失败')).toBeInTheDocument();
    expect(screen.getByText('网络不可用')).toBeInTheDocument();
    expect(screen.queryByText('暂无评估项目')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /重试/ }));
    expect(await screen.findByText('核心业务系统')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('评估项目加载失败')).not.toBeInTheDocument());
  });

  it('uses a Chinese business empty state after a successful request', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { items: [] } } as any);

    render(<MemoryRouter><ReviewTaskList /></MemoryRouter>);

    expect(await screen.findByText('暂无评估项目')).toBeInTheDocument();
  });

  it('keeps frequent desktop columns visible and puts secondary metadata in the expanded row', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.get).mockResolvedValue({ data: { items: [task] } } as any);

    render(<MemoryRouter><ReviewTaskList /></MemoryRouter>);

    await screen.findByText('核心业务系统');
    expect(screen.getAllByText('项目状态').length).toBeGreaterThan(0);
    expect(screen.getAllByText('填写进度').length).toBeGreaterThan(0);
    expect(screen.queryByText('创建人甲')).not.toBeInTheDocument();

    await user.click(document.querySelector('.ant-table-row-expand-icon') as HTMLElement);
    expect((await screen.findAllByText('创建人甲')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('责任人乙').length).toBeGreaterThan(0);
    expect(screen.getAllByText('创建时间').length).toBeGreaterThan(0);
  });
});
