import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardApi } from '../../api/account';
import AccountDashboard from './Dashboard';

vi.mock('../../api/account', () => ({
  dashboardApi: {
    overview: vi.fn(),
    trends: vi.fn(),
    distribution: vi.fn(),
    ranking: vi.fn(),
  },
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ children }: any) => <div>{children}</div>,
  Cell: () => null,
  Legend: () => null,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

function mockDashboardSuccess(options?: { distribution?: Record<string, number>; ranking?: any[]; trends?: any[] }) {
  vi.mocked(dashboardApi.overview).mockResolvedValue({
    data: { dataSourcesCount: 0, totalAccounts: 0, totalProblems: 0, highRiskCount: 0, pendingCount: 0 },
  } as any);
  vi.mocked(dashboardApi.trends).mockResolvedValue({ data: options?.trends ?? [{ date: '2026-08-20', count: 0 }] } as any);
  vi.mocked(dashboardApi.distribution).mockResolvedValue({
    data: options?.distribution ?? { HIGH: 0, MEDIUM: 0, LOW: 0 },
  } as any);
  vi.mocked(dashboardApi.ranking).mockResolvedValue({ data: options?.ranking ?? [{ sourceName: 'HR', problemCount: 0 }] } as any);
}

describe('AccountDashboard states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    mockDashboardSuccess();
  });

  it('renders explicit empty states when successful chart values are all zero', async () => {
    render(<MemoryRouter><AccountDashboard /></MemoryRouter>);

    expect(await screen.findByText('当前没有风险问题')).toBeInTheDocument();
    expect(screen.getByText('当前没有可排行的问题数据')).toBeInTheDocument();
    expect(screen.getByText('近 30 天暂无新增问题')).toBeInTheDocument();
    expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument();
  });

  it('distinguishes an API failure from a successful empty result and retries', async () => {
    const user = userEvent.setup();
    vi.mocked(dashboardApi.distribution).mockRejectedValueOnce(new Error('request failed'));

    render(<MemoryRouter><AccountDashboard /></MemoryRouter>);

    expect(await screen.findByText('部分账户审计数据加载失败')).toBeInTheDocument();
    expect(screen.getAllByText('风险分布加载失败').length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole('button', { name: /重\s*试/ })[0]);

    await waitFor(() => expect(dashboardApi.distribution).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('部分账户审计数据加载失败')).not.toBeInTheDocument());
    expect(screen.getByText('当前没有风险问题')).toBeInTheDocument();
  });

  it('renders charts when at least one value is positive', async () => {
    mockDashboardSuccess({
      distribution: { HIGH: 1, MEDIUM: 0, LOW: 0 },
      ranking: [{ sourceName: 'HR', problemCount: 2 }],
      trends: [{ date: '2026-08-20', count: 3 }],
    });

    render(<MemoryRouter><AccountDashboard /></MemoryRouter>);

    await waitFor(() => expect(screen.getByTestId('pie-chart')).toBeInTheDocument());
    expect(screen.getAllByTestId('bar-chart')).toHaveLength(2);
  });
});
