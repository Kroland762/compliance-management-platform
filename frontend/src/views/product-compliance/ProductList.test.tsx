import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { useAuthStore } from '../../store/auth';
import ProductList from './ProductList';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../components/lookups', () => {
  const Lookup = ({ value, onChange, ...props }: any) => <select {...props} value={value || ''} onChange={(event) => onChange?.(event.target.value)}><option value="">请选择</option><option value="option-1">测试选项</option></select>;
  return { LookupSelect: Lookup, DepartmentSelect: Lookup, PersonnelSelect: Lookup };
});

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderPage() {
  return render(<MemoryRouter initialEntries={['/product-compliance/products']}><Routes>
    <Route path="/product-compliance/products" element={<><ProductList /><LocationProbe /></>} />
    <Route path="/product-compliance/products/:id" element={<LocationProbe />} />
  </Routes></MemoryRouter>);
}

describe('ProductList usability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })),
    });
    useAuthStore.setState({
      user: {
        id: 'owner-1', username: 'owner', email: null, role: '产品负责人', roleIds: [],
        permissions: { products: ['read', 'create'] }, permissionScopes: {}, departmentIds: [],
        mustChangePassword: false, isGlobalAdmin: false,
      },
    });
    vi.mocked(apiClient.get).mockResolvedValue({ data: { items: [], pagination: { page: 1, pageSize: 20, total: 0 } } } as any);
  });

  it('shows a Chinese first-use empty state and visible active filters', async () => {
    renderPage();

    expect(await screen.findByText('暂无使用中的产品。先创建产品，再创建版本和合规档案。')).toBeInTheDocument();
    expect(screen.getByText('共 0 个产品')).toBeInTheDocument();
    expect(screen.getByText('产品状态：使用中')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /清除全部/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /创建首个产品/ })).toBeInTheDocument();
  });

  it('keeps the modal usable at desktop height and opens the new product detail after creation', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockResolvedValue({ data: { id: 'product-9' } } as any);
    renderPage();

    await screen.findByText('产品台账');
    await user.click(screen.getByRole('button', { name: /新增产品/ }));
    expect(screen.getByRole('button', { name: /取\s*消/ })).toBeInTheDocument();
    expect(document.querySelector('.ant-modal-body')).toHaveStyle({ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' });

    await user.type(screen.getByLabelText('产品编码'), 'WEB_APP');
    await user.type(screen.getByLabelText('产品名称'), 'Web 产品');
    await user.selectOptions(screen.getByLabelText('默认产品类型'), 'option-1');
    await user.selectOptions(screen.getByLabelText('归属部门'), 'option-1');
    await user.selectOptions(screen.getByLabelText('产品负责人'), 'option-1');
    await user.click(screen.getByRole('button', { name: /^创\s*建$/ }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/product-compliance/products', expect.objectContaining({ code: 'WEB_APP', name: 'Web 产品' })));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/product-compliance/products/product-9'));
  });
});
