import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';
import Dashboard from './Dashboard';

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
vi.mock('recharts', () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Wrapper, PieChart: Wrapper, Pie: Wrapper, LineChart: Wrapper,
    Cell: () => null, Tooltip: () => null, Legend: () => null, Line: () => null,
    XAxis: () => null, YAxis: () => null, CartesianGrid: () => null,
  };
});

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false, media: query, onchange: null,
        addListener: vi.fn(), removeListener: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
      })),
    });
    useAuthStore.setState({
      user: {
        id: 'admin-1', username: 'admin', email: null, role: '管理员', roleIds: [],
        permissions: { dashboard: ['read'], tasks: ['read'], risks: ['read'] },
        permissionScopes: {}, departmentIds: [], mustChangePassword: false, isGlobalAdmin: false,
      },
    });
  });

  it('renders explicit empty states when chart series only contain zero values', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        summary: {},
        taskPie: [{ name: '进行中', value: 0 }],
        riskPie: [{ name: '高风险', value: 0 }],
        riskTrend: [{ month: '8月', created: 0, closed: 0 }],
      },
    } as any);

    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    expect(await screen.findByText('暂无评估项目数据')).toBeInTheDocument();
    expect(screen.getByText('暂无风险分布数据')).toBeInTheDocument();
    expect(screen.getByText('本月暂无风险变化')).toBeInTheDocument();
  });
});
