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
      if (url === '/lookup/options/departments') {
        const departments = [
          { value: '11111111-1111-4111-8111-111111111111', label: '财务部', disabled: false },
          { value: '22222222-2222-4222-8222-222222222222', label: '风险管理部', disabled: false },
        ];
        const keyword = String(config.params?.q || '').toLowerCase();
        const items = departments.filter((department) => department.label.toLowerCase().includes(keyword));
        return { data: { items, selectedItems: [], pagination: { page: 1, pageSize: 20, total: items.length, totalPages: 1, hasMore: false } } } as any;
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

  it('normalizes a newly entered asset code to uppercase', async () => {
    const user = userEvent.setup();
    render(<AssetLedger />);

    await screen.findByText('示例应用');
    await user.click(screen.getByRole('button', { name: /新增资产/ }));
    const codeInput = await screen.findByLabelText('资产编码');
    await user.type(codeInput, 'core-banking_01');

    expect(codeInput).toHaveValue('CORE-BANKING_01');
    await user.type(screen.getByLabelText('资产名称'), '核心系统');
    await user.click(screen.getByLabelText('资产类型'));
    const systemOption = (await screen.findAllByText('system'))
      .find((element) => element.classList.contains('ant-select-item-option-content'))!;
    await user.click(systemOption.closest('.ant-select-item-option') as HTMLElement);
    await user.click(screen.getByRole('button', { name: /创.*建/ }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/assets', expect.objectContaining({
      code: 'CORE-BANKING_01', name: '核心系统', assetType: 'system',
    })));
  });

  it('shows and filters responsibility departments by human-readable name only', async () => {
    const user = userEvent.setup();
    render(<AssetLedger />);

    await screen.findByText('示例应用');
    await user.click(screen.getByRole('button', { name: /新增资产/ }));
    const departmentSelect = await screen.findByLabelText('责任部门');
    expect(screen.getByText('输入部门名称检索')).toBeInTheDocument();
    await user.click(departmentSelect);
    expect(await screen.findByText('风险管理部')).toBeInTheDocument();
    expect(screen.queryByText('风险管理部 (RISK)')).not.toBeInTheDocument();

    await user.type(departmentSelect, '风险');

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/lookup/options/departments', expect.objectContaining({
      params: expect.objectContaining({ purpose: 'asset-owner', q: '风险' }),
    })));
    expect(await screen.findByText('风险管理部')).toBeInTheDocument();
    expect(screen.queryByText('财务部')).not.toBeInTheDocument();

    await user.clear(departmentSelect);
    await user.type(departmentSelect, 'RISK');

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/lookup/options/departments', expect.objectContaining({
      params: expect.objectContaining({ purpose: 'asset-owner', q: 'RISK' }),
    })));
    expect(screen.queryByText('风险管理部')).not.toBeInTheDocument();
    expect(screen.queryByText('财务部')).not.toBeInTheDocument();
  });
});
