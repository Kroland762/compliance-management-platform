import { render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.queryByRole('button', { name: /添加数据源/ })).not.toBeInTheDocument();
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
