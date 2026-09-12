import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { useAuthStore } from '../../store/auth';
import ProductDetail from './ProductDetail';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../components/lookups', () => ({ LookupSelect: () => null }));

describe('ProductDetail usability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })),
    });
    useAuthStore.setState({
      user: {
        id: 'owner-1', username: 'owner', email: null, role: '产品负责人', roleIds: [],
        permissions: { products: ['read', 'update'] }, permissionScopes: {}, departmentIds: [],
        mustChangePassword: false, isGlobalAdmin: false,
      },
    });
  });

  it('shows an actionable error and recovers through retry', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.get)
      .mockRejectedValueOnce({ error: { message: '产品读取失败' } })
      .mockResolvedValueOnce({ data: { id: 'product-1', code: 'WEB', name: 'Web 产品', status: 'active', defaultProductTypeId: 'type-1', defaultProductType: { name: 'Web' }, versions: [] } } as any);

    render(<MemoryRouter initialEntries={['/product-compliance/products/product-1']}><Routes><Route path="/product-compliance/products/:id" element={<ProductDetail />} /></Routes></MemoryRouter>);

    expect(await screen.findByText('无法加载产品详情')).toBeInTheDocument();
    expect(screen.getByText('产品读取失败')).toBeInTheDocument();
    expect(screen.getByText('产品台账')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /重\s*试/ }));

    expect(await screen.findByText('版本时间线')).toBeInTheDocument();
    expect(screen.getByText('尚未创建产品版本。创建首个版本后即可填写合规档案。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /创建首个版本/ })).toBeInTheDocument();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
  });
});
