import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataSourceApi } from '../../api/account';
import { useAuthStore } from '../../store/auth';
import DataSourceList from './DataSourceList';

vi.mock('../../api/account', () => ({
  dataSourceApi: {
    list: vi.fn(),
    testConnection: vi.fn(),
    sync: vi.fn(),
    toggle: vi.fn(),
    delete: vi.fn(),
    previewCsv: vi.fn(),
    reuploadCsv: vi.fn(),
  },
}));

describe('DataSourceList permissions', () => {
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
    vi.mocked(dataSourceApi.list).mockResolvedValue({ data: { items: [] } } as any);
    useAuthStore.setState({
      user: {
        id: 'auditor-1', username: 'auditor', role: '审计员', roleIds: [],
        permissions: { data_sources: ['read'] }, permissionScopes: {}, departmentIds: [],
        email: null, mustChangePassword: false, isGlobalAdmin: false,
      },
    });
  });

  it('does not show a create action to a read-only account', async () => {
    render(<MemoryRouter><DataSourceList /></MemoryRouter>);
    await waitFor(() => expect(dataSourceApi.list).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: '数据源' })).toBeInTheDocument();
    expect(screen.getByText('还没有数据源，请先添加一个数据源')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /添加数据源/ })).not.toBeInTheDocument();
  });

  it('shows a persistent load error and retries successfully', async () => {
    const user = userEvent.setup();
    vi.mocked(dataSourceApi.list)
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ data: { items: [] } } as any);

    render(<MemoryRouter><DataSourceList /></MemoryRouter>);

    expect(await screen.findByText('数据源列表加载失败')).toBeInTheDocument();
    expect(screen.getByText('network unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /重\s*试/ }));

    await waitFor(() => expect(dataSourceApi.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('数据源列表加载失败')).not.toBeInTheDocument());
    expect(screen.getByText('还没有数据源，请先添加一个数据源')).toBeInTheDocument();
  });

  it('offers the add action in an empty list when creation is allowed', async () => {
    useAuthStore.setState(state => ({
      ...state,
      user: state.user ? { ...state.user, permissions: { data_sources: ['read', 'create'] } } : null,
    }));

    render(<MemoryRouter><DataSourceList /></MemoryRouter>);

    await waitFor(() => expect(dataSourceApi.list).toHaveBeenCalled());
    expect(screen.getAllByRole('button', { name: /添加数据源/ })).toHaveLength(2);
  });

  it('renders CSV systems distinctly and exposes reupload only with sync permission', async () => {
    vi.mocked(dataSourceApi.list).mockResolvedValue({
      data: {
        items: [{
          id: 'csv-1', name: 'HR CSV', sourceType: 'CSV', mappingStatus: 'CONFIGURED',
          taskCount: 1, totalAccounts: 2, status: 'ACTIVE', lastSyncTime: null,
          createdAt: '2026-08-20T00:00:00Z', updatedAt: '2026-08-20T00:00:00Z',
          fieldMappingConfig: { accountId: 'uid' },
        }],
      },
    } as any);
    useAuthStore.setState(state => ({
      ...state,
      user: state.user ? { ...state.user, permissions: { data_sources: ['read', 'sync'] } } : null,
    }));

    render(<MemoryRouter><DataSourceList /></MemoryRouter>);

    expect(await screen.findByText('HR CSV')).toBeInTheDocument();
    expect(screen.getByText('CSV')).toBeInTheDocument();
    expect(screen.queryByText('点击检测')).not.toBeInTheDocument();
    expect(document.querySelector('.anticon-upload')).toBeInTheDocument();
  });
});
