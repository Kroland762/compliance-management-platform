import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';
import AssetLedger from './AssetLedger';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

const activeAsset = {
  id: 'asset-1',
  code: 'APP-001',
  name: '示例应用',
  assetType: 'application',
  criticality: 'high',
  ownerDepartmentId: null,
  ownerUserId: null,
  description: '原说明',
  status: 'active',
};

const archivedAsset = {
  ...activeAsset,
  id: 'asset-2',
  code: 'APP-002',
  name: '历史应用',
  status: 'archived',
};

describe('AssetLedger', () => {
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
    useAuthStore.setState({
      user: {
        id: 'user-1',
        username: 'admin',
        email: null,
        role: '管理员',
        roleIds: [],
        permissions: { assets: ['create', 'read', 'update', 'archive'] },
        permissionScopes: {},
        departmentIds: [],
        mustChangePassword: false,
        isGlobalAdmin: false,
      },
    });
    vi.mocked(apiClient.get).mockImplementation(async (url, config: any = {}) => {
      if (url === '/assets') {
        const status = config.params?.status;
        const items = status === 'archived' ? [archivedAsset] : [activeAsset];
        return { data: { items, pagination: { page: 1, pageSize: 20, total: 1 } } } as any;
      }
      return { data: [] } as any;
    });
    vi.mocked(apiClient.put).mockResolvedValue({ data: activeAsset } as any);
    vi.mocked(apiClient.post).mockResolvedValue({ data: activeAsset } as any);
  });

  it('edits an active asset without submitting its immutable code', async () => {
    const user = userEvent.setup();
    render(<AssetLedger />);

    await screen.findByText('示例应用');
    await user.click(screen.getByRole('button', { name: /编辑/ }));
    const nameInput = await screen.findByLabelText('资产名称');
    await user.clear(nameInput);
    await user.type(nameInput, '更新后的应用');
    await user.click(screen.getByRole('button', { name: /保.*存/ }));

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/assets/asset-1', expect.objectContaining({
      name: '更新后的应用',
    })));
    expect(vi.mocked(apiClient.put).mock.calls[0][1]).not.toHaveProperty('code');
  });

  it('loads archived assets through the status filter and offers restore', async () => {
    const user = userEvent.setup();
    render(<AssetLedger />);

    await screen.findByText('示例应用');
    await user.click(screen.getByText('已归档'));

    await screen.findByText('历史应用');
    expect(apiClient.get).toHaveBeenCalledWith('/assets', {
      params: { page: 1, pageSize: 20, status: 'archived' },
    });
    expect(screen.getByRole('button', { name: /恢复/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /编辑/ })).not.toBeInTheDocument();
  });
});
