import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';
import EvaluationWorkbench from './EvaluationWorkbench';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../components/FilePreviewModal', () => ({ default: () => null }));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

describe('EvaluationWorkbench column layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
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
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      value: MouseEvent,
    });
    useAuthStore.setState({
      user: {
        id: 'member-1',
        username: 'member',
        email: null,
        role: '填写人',
        roleIds: [],
        permissions: { evaluations: ['read', 'answer', 'submit'], tasks: ['update'] },
        permissionScopes: {},
        departmentIds: [],
        mustChangePassword: false,
        isGlobalAdmin: false,
      },
    });
    vi.mocked(apiClient.get).mockImplementation(async (url) => {
      if (url === '/tasks/task-1') return {
        data: {
          id: 'task-1',
          name: '示例评估',
          columnSchemaSnapshot: [
            { key: 'sequenceNumber', label: '序号', source: 'core', visible: true, width: 140 },
            { key: 'controlDomain', label: '控制域名', source: 'core', visible: true, width: 240 },
            { key: 'controlPoint', label: '控制点', source: 'core', visible: true, width: 320 },
            { key: 'extraData.检查内容', label: '检查内容', source: 'extra', visible: true, width: 320 },
          ],
        },
      } as any;
      if (url === '/tasks/task-1/assets') return {
        data: { items: [{ assetId: 'asset-1', assetNameSnapshot: '生产系统' }] },
      } as any;
      if (url === '/lookup/options/personnel') return {
        data: {
          items: [
            { value: 'member-1', label: '当前责任人', disabled: false, meta: { userId: 'member-1', username: 'member' } },
            { value: 'member-2', label: '新责任人', disabled: false, meta: { userId: 'member-2', username: 'member-2' } },
          ],
          selectedItems: [],
          pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1, hasMore: false },
        },
      } as any;
      if (url === '/tasks/task-1/evaluations/filter-options') return {
        data: {
          controlDomains: ['访问控制'],
          dynamicColumns: {
            'extraData.检查内容': { mode: 'select', options: ['必须启用强密码'], hasEmpty: false },
          },
        },
      } as any;
      if (url === '/tasks/task-1/evaluations') return {
        data: {
          items: [{
            id: 'evaluation-1',
            sequenceNumber: 'A.1',
            controlPoint: '身份鉴别',
            controlDomain: '访问控制',
            templateDataSnapshot: {
              sequenceNumber: 'A.1',
              controlPoint: '身份鉴别',
              controlDomain: '访问控制',
              extraData: { 检查内容: '必须启用强密码' },
            },
            workflowStatus: 'in_progress',
            complianceStatus: 'not_assessed',
            assignedTo: 'member-1',
            assignee: { userId: 'member-1', displayName: '当前责任人' },
            currentStatusDescription: '',
            assets: [{ id: 'asset-1', name: '生产系统' }],
            evidenceFiles: [],
            historyCount: 0,
            lockVersion: 0,
          }],
          pagination: { page: 1, pageSize: 100, total: 1 },
        },
      } as any;
      if (url === '/evaluations/evaluation-1/history') return {
        data: [
          {
            id: 'history-answer',
            currentStatusDescription: '上期实际回答',
            matchedAssetIds: ['asset-1'],
            assets: [{ id: 'asset-1', name: '生产系统' }],
            evidenceFiles: [],
            task: { id: 'old-task-answer', name: '上期评估', version: '2025', reviewedAt: '2025-12-01T00:00:00.000Z' },
          },
          {
            id: 'history-evidence',
            currentStatusDescription: '',
            matchedAssetIds: ['asset-1'],
            assets: [{ id: 'asset-1', name: '生产系统' }],
            evidenceFiles: [{ id: 'evidence-1', originalFilename: '历史证据.pdf' }],
            task: { id: 'old-task-evidence', name: '更早评估', version: '2024', reviewedAt: '2024-12-01T00:00:00.000Z' },
          },
        ],
      } as any;
      throw new Error(`unexpected GET ${url}`);
    });
    vi.mocked(apiClient.put).mockImplementation(async (url, data: any) => {
      if (url === '/evaluations/evaluation-1/answer') return {
        data: {
          id: 'evaluation-1', sequenceNumber: 'A.1', controlPoint: '身份鉴别', controlDomain: '访问控制',
          workflowStatus: 'in_progress', complianceStatus: 'not_assessed', currentStatusDescription: data.currentStatusDescription,
          assets: [{ id: 'asset-1', name: '生产系统' }], evidenceFiles: [], historyCount: 0, lockVersion: 1,
        },
      } as any;
      if (url === '/tasks/task-1/column-schema/sync') return {
        data: {
          columnSchemaSnapshot: [
            { key: 'history', label: '历史回答与证据', source: 'system', visible: true, width: 150 },
            { key: 'sequenceNumber', label: '序号', source: 'core', visible: true, width: 100 },
            { key: 'controlPoint', label: '评估点与要求', source: 'core', visible: true, width: 400 },
            { key: 'extraData.检查内容', label: '检查内容', source: 'extra', visible: true, width: 320 },
            { key: 'assets', label: '关联资产', source: 'system', visible: true, width: 260 },
            { key: 'assignee', label: '责任人', source: 'system', visible: true, width: 180 },
            { key: 'answer', label: '现状说明', source: 'system', visible: true, width: 320 },
            { key: 'controlDomain', label: '控制域名', source: 'core', visible: true, width: 240 },
            { key: 'evidence', label: '本次证据', source: 'system', visible: true, width: 220 },
            { key: 'compliance', label: '符合性结论', source: 'system', visible: true, width: 150 },
            { key: 'status', label: '状态', source: 'system', visible: true, width: 120 },
            { key: 'actions', label: '流程操作', source: 'system', visible: true, width: 180 },
          ],
        },
      } as any;
      if (url === '/evaluations/evaluation-1/assignee') return {
        data: {
          id: 'evaluation-1', sequenceNumber: 'A.1', controlPoint: '身份鉴别', controlDomain: '访问控制',
          workflowStatus: 'in_progress', complianceStatus: 'not_assessed', currentStatusDescription: '',
          assignedTo: 'member-2', assignee: { userId: 'member-2', displayName: '新责任人' },
          assets: [{ id: 'asset-1', name: '生产系统' }], evidenceFiles: [], historyCount: 0, lockVersion: 1,
        },
      } as any;
      throw new Error(`unexpected PUT ${url}`);
    });
    vi.mocked(apiClient.post).mockImplementation(async (url) => {
      if (url === '/evaluations/evaluation-1/submit') return {
        data: { id: 'evaluation-1', workflowStatus: 'submitted', lockVersion: 2 },
      } as any;
      if (url === '/tasks/task-1/evaluations/bulk-submit') return { data: {} } as any;
      throw new Error(`unexpected POST ${url}`);
    });
  });

  it('loads, resizes, persists, and resets a personal column width', async () => {
    const storageKey = 'evaluation-workbench:column-widths:member-1:task-1';
    window.localStorage.setItem(storageKey, JSON.stringify({ sequenceNumber: 180 }));
    const { container } = render(
      <MemoryRouter initialEntries={['/assessments/task-1/workbench']}>
        <Routes><Route path="/assessments/:id/workbench" element={<EvaluationWorkbench />} /></Routes>
      </MemoryRouter>,
    );

    await screen.findByText('身份鉴别');
    const header = container.querySelector('.evaluation-workbench-table .ant-table-thead');
    expect(header).not.toBeNull();
    let handle = within(header as HTMLElement).getByRole('separator', { name: '调整序号列宽' });
    expect(handle).toHaveAttribute('aria-valuenow', '180');

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 160, pointerId: 1 });
    fireEvent.pointerUp(document, { clientX: 160, pointerId: 1 });
    await waitFor(() => {
      handle = within(header as HTMLElement).getByRole('separator', { name: '调整序号列宽' });
      expect(handle).toHaveAttribute('aria-valuenow', '240');
    });
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(storageKey) || '{}'))
      .toMatchObject({ sequenceNumber: 240 }));

    fireEvent.doubleClick(handle);
    await waitFor(() => {
      handle = within(header as HTMLElement).getByRole('separator', { name: '调整序号列宽' });
      expect(handle).toHaveAttribute('aria-valuenow', '100');
      expect(window.localStorage.getItem(storageKey)).toBeNull();
    });
  });

  it('renders legacy snapshots in the recommended full-table order', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={['/assessments/task-1/workbench']}>
        <Routes>
          <Route path="/assessments/:id/workbench" element={<EvaluationWorkbench />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );

    const controlPoint = await screen.findByText('身份鉴别');
    expect(controlPoint.tagName).toBe('SPAN');
    const header = container.querySelector('.evaluation-workbench-table .ant-table-thead');
    expect(header).not.toBeNull();
    const labels = () => within(header as HTMLElement).getAllByRole('columnheader')
      .map((cell) => cell.textContent?.trim() || '')
      .filter(Boolean);
    expect(labels()).toEqual([
      '序号', '评估点', '关联资产', '责任人', '现状说明',
      '控制域名', '评估要求', '本次证据', '历史回答与证据', '符合性结论', '不符合项描述', '严重度', '状态', '流程操作',
    ]);
    expect(container.querySelector('.evaluation-workbench-table .ant-table-cell-fix-left')).toBeNull();
    expect(screen.getByRole('combobox', { name: '关联资产' }).closest('td')).toHaveClass('evaluation-assets-cell');
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(4));
    expect(screen.queryByRole('combobox', { name: '设置 A.1 的符合性结论' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: '设置 A.1 的责任人' }));
    await user.click(await screen.findByText('新责任人'));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      '/evaluations/evaluation-1/assignee',
      { assigneeUserId: 'member-2' },
      { headers: { 'If-Match': '"0"' } },
    ));
    await user.click(screen.getByRole('button', { name: /查看/ }));
    await screen.findByRole('dialog', { name: /历史回答与证据/ });
    expect(await screen.findByText('上期实际回答')).toBeInTheDocument();
    expect(screen.getByText('无历史证据')).toBeInTheDocument();
    expect(screen.getByText('无历史回答')).toBeInTheDocument();
    expect(await screen.findByText('历史证据.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));

    await user.click(screen.getByRole('button', { name: /同步模板列配置/ }));
    await user.click(screen.getByRole('button', { name: /确认同步/ }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/tasks/task-1/column-schema/sync'));
    expect(labels()).toEqual([
      '历史回答与证据', '序号', '评估点', '评估要求', '关联资产', '责任人', '现状说明',
      '控制域名', '本次证据', '符合性结论', '不符合项描述', '严重度', '状态', '流程操作',
    ]);

    const answer = screen.getByRole('textbox', { name: '填写 A.1 的现状说明' });
    fireEvent.change(answer, { target: { value: '筛选前草稿' } });
    fireEvent.blur(answer);
    expect(apiClient.put).not.toHaveBeenCalledWith('/evaluations/evaluation-1/answer', expect.anything());
    expect(screen.getByText('当前有 1 行未提交。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '仅看待我处理' }));
    expect(apiClient.put).not.toHaveBeenCalledWith('/evaluations/evaluation-1/answer', expect.anything());
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/tasks/task-1/evaluations', expect.objectContaining({
      params: expect.objectContaining({ filters: JSON.stringify({ mine: true }) }),
    })));
    expect(screen.getByRole('textbox', { name: '填写 A.1 的现状说明' })).toHaveValue('筛选前草稿');
    expect(screen.getByText('仅看待我处理', { selector: '.ant-tag' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent('filters='));

    await user.click(screen.getByRole('button', { name: /^提\s*交$/ }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/evaluations/evaluation-1/answer', {
      currentStatusDescription: '筛选前草稿',
      lockVersion: 0,
    }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/evaluations/evaluation-1/submit',
      {},
      { headers: { 'If-Match': '"1"' } },
    ));

    await user.type(screen.getByRole('textbox', { name: '搜索评估点和要求' }), '身份');
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/tasks/task-1/evaluations', expect.objectContaining({
      params: expect.objectContaining({ q: '身份', filters: JSON.stringify({ mine: true }) }),
    })));
    await user.click(screen.getByRole('button', { name: /清除全部/ }));
    await waitFor(() => expect(screen.queryByLabelText('已生效筛选条件')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '筛选 评估要求' }));
    expect(await screen.findByPlaceholderText('搜索评估要求')).toBeInTheDocument();
    expect(screen.getByText('包含关键词')).toBeInTheDocument();
  }, 10_000);

  it('saves and submits selected drafts in one bulk request', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/assessments/task-1/workbench']}>
        <Routes><Route path="/assessments/:id/workbench" element={<EvaluationWorkbench />} /></Routes>
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByRole('textbox', { name: '填写 A.1 的现状说明' }), {
      target: { value: '批量提交草稿' },
    });
    await user.click(screen.getAllByRole('checkbox')[1]);
    await user.click(screen.getByRole('button', { name: '批量提交（1）' }));

    expect(apiClient.put).not.toHaveBeenCalledWith('/evaluations/evaluation-1/answer', expect.anything());
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/tasks/task-1/evaluations/bulk-submit', {
      items: [{ id: 'evaluation-1', lockVersion: 0, currentStatusDescription: '批量提交草稿' }],
    }));
  });

  it('lets a user with both answer and review permissions choose a conclusion while filling', async () => {
    useAuthStore.setState({
      user: {
        id: 'member-1', username: 'member', email: null, role: '审计员', roleIds: [],
        permissions: { evaluations: ['read', 'answer', 'submit', 'claim', 'review'], tasks: ['update'] },
        permissionScopes: {}, departmentIds: [], mustChangePassword: false, isGlobalAdmin: false,
      },
    });
    const baseGet = vi.mocked(apiClient.get).getMockImplementation()!;
    vi.mocked(apiClient.get).mockImplementation(async (url, config) => {
      if (url === '/tasks/task-1/evaluations') return {
        data: {
          items: [{
            id: 'evaluation-1', sequenceNumber: 'A.1', controlPoint: '身份鉴别', controlDomain: '访问控制',
            templateDataSnapshot: { sequenceNumber: 'A.1', controlPoint: '身份鉴别', controlDomain: '访问控制', extraData: { 检查内容: '必须启用强密码' } },
            workflowStatus: 'in_progress', complianceStatus: 'not_assessed', assignedTo: 'member-2',
            assignee: { userId: 'member-2', displayName: '其他责任人' }, reviewClaimedBy: null,
            currentStatusDescription: '已经完成检查', assets: [{ id: 'asset-1', name: '生产系统' }],
            evidenceFiles: [], historyCount: 0, lockVersion: 0,
          }],
          pagination: { page: 1, pageSize: 100, total: 1 }, summary: { unfilteredTotal: 1 },
        },
      } as any;
      return baseGet(url, config);
    });
    vi.mocked(apiClient.post).mockImplementation(async (url) => {
      if (url === '/evaluations/evaluation-1/review-claim') return {
        data: {
          id: 'evaluation-1', sequenceNumber: 'A.1', workflowStatus: 'submitted', complianceStatus: 'not_assessed',
          assignedTo: 'member-1', reviewClaimedBy: 'member-1', currentStatusDescription: '已经完成检查',
          assets: [{ id: 'asset-1', name: '生产系统' }], evidenceFiles: [], lockVersion: 1,
        },
      } as any;
      if (url === '/evaluations/evaluation-1/review') return { data: { id: 'evaluation-1', workflowStatus: 'reviewed', complianceStatus: 'compliant' } } as any;
      throw new Error(`unexpected POST ${url}`);
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/assessments/task-1/workbench']}>
        <Routes><Route path="/assessments/:id/workbench" element={<EvaluationWorkbench />} /></Routes>
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByRole('textbox', { name: '填写 A.1 的现状说明' }), {
      target: { value: '管理员未提交草稿' },
    });
    const conclusion = await screen.findByRole('combobox', { name: '设置 A.1 的符合性结论' });
    await user.click(conclusion);
    const dropdown = await waitFor(() => {
      const element = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    const compliantOption = within(dropdown).getByText('符合').closest('.ant-select-item-option');
    expect(compliantOption).not.toBeNull();
    fireEvent.click(compliantOption as HTMLElement);
    expect(screen.queryByRole('dialog', { name: '复核评估行' })).not.toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalledWith('/evaluations/evaluation-1/review-claim');
    expect(apiClient.put).not.toHaveBeenCalledWith('/evaluations/evaluation-1/answer', expect.anything());
    expect(apiClient.post).not.toHaveBeenCalledWith('/evaluations/evaluation-1/review', expect.anything(), expect.anything());
    await user.click(screen.getByRole('button', { name: /复\s*核/ }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/evaluations/evaluation-1/answer', {
      currentStatusDescription: '管理员未提交草稿',
      lockVersion: 0,
    }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/evaluations/evaluation-1/review',
      expect.objectContaining({ complianceStatus: 'compliant', return: false }),
      { headers: { 'If-Match': '"1"' } },
    ));
  }, 10_000);

  it('reviews inline with finding fields and exposes return, review, and name-based transfer', async () => {
    useAuthStore.setState({
      user: {
        id: 'member-1', username: 'reviewer_one', email: null, role: '管理员', roleIds: [],
        permissions: { evaluations: ['read', 'claim', 'review'], tasks: ['read', 'update'] },
        permissionScopes: { tasks: { update: 'all' } }, departmentIds: [], mustChangePassword: false, isGlobalAdmin: false,
      },
    });
    const baseGet = vi.mocked(apiClient.get).getMockImplementation()!;
    vi.mocked(apiClient.get).mockImplementation(async (url, config) => {
      if (url === '/tasks/task-1') {
        const response: any = await baseGet(url, config);
        return { data: { ...response.data, auditors: [
          { auditorUserId: 'member-1', auditor: { username: 'reviewer_one' } },
          { auditorUserId: 'member-3', auditor: { username: 'target_reviewer' } },
        ] } } as any;
      }
      if (url === '/lookup/options/auditors') return {
        data: {
          items: [
            { value: 'member-1', label: '复核人', disabled: false, meta: { username: 'reviewer_one' } },
            { value: 'member-3', label: '目标复核人', disabled: false, meta: { username: 'target_reviewer' } },
          ],
          selectedItems: [],
          pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1, hasMore: false },
        },
      } as any;
      if (url === '/tasks/task-1/evaluations') return {
        data: {
          items: [{
            id: 'evaluation-1', sequenceNumber: 'A.1', controlPoint: '身份鉴别', controlDomain: '访问控制',
            templateDataSnapshot: { sequenceNumber: 'A.1', controlPoint: '身份鉴别', controlDomain: '访问控制' },
            workflowStatus: 'submitted', complianceStatus: 'not_assessed', assignedTo: 'member-2',
            assignee: { userId: 'member-2', displayName: '填写人' }, reviewClaimedBy: 'member-1',
            currentStatusDescription: '已提交回答', assets: [{ id: 'asset-1', name: '生产系统' }],
            evidenceFiles: [], historyCount: 0, lockVersion: 3,
          }],
          pagination: { page: 1, pageSize: 100, total: 1 }, summary: { unfilteredTotal: 1 },
        },
      } as any;
      return baseGet(url, config);
    });
    vi.mocked(apiClient.post).mockResolvedValue({ data: {} } as any);
    vi.mocked(apiClient.put).mockResolvedValue({ data: {} } as any);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/assessments/task-1/workbench']}>
        <Routes><Route path="/assessments/:id/workbench" element={<EvaluationWorkbench />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: /退\s*回/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /复\s*核/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /转\s*派/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /释\s*放/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /复\s*核/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请先选择符合性结论');

    const conclusion = screen.getByRole('combobox', { name: '设置 A.1 的符合性结论' });
    await user.click(conclusion);
    const conclusionDropdown = await waitFor(() => {
      const element = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    fireEvent.click(within(conclusionDropdown).getByText('不符合').closest('.ant-select-item-option') as HTMLElement);
    const description = screen.getByRole('textbox', { name: '填写 A.1 的不符合项描述' });
    expect(description).toBeEnabled();
    await user.type(description, '未启用多因素认证');
    const severity = screen.getByRole('combobox', { name: '设置 A.1 的严重度' });
    await user.click(severity);
    const severityDropdown = await waitFor(() => {
      const element = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    fireEvent.click(within(severityDropdown).getByText('高').closest('.ant-select-item-option') as HTMLElement);
    expect(apiClient.post).not.toHaveBeenCalledWith('/evaluations/evaluation-1/review', expect.anything(), expect.anything());
    await user.click(screen.getByRole('button', { name: /复\s*核/ }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/evaluations/evaluation-1/review', {
      complianceStatus: 'non_compliant',
      return: false,
      finding: { description: '未启用多因素认证', severity: 'high' },
    }, { headers: { 'If-Match': '"3"' } }));

    await user.click(screen.getByRole('button', { name: /转\s*派/ }));
    const transferSearch = await screen.findByRole('combobox', { name: '按姓名搜索复核人' });
    await user.type(transferSearch, '目标');
    expect(await screen.findByText('目标复核人')).toBeInTheDocument();
    expect(screen.queryByText('member-3', { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument();
    await user.click(screen.getByText('目标复核人'));
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/evaluations/evaluation-1/review-claim', { auditorUserId: 'member-3' }));

    await user.click(screen.getByRole('button', { name: /退\s*回/ }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/evaluations/evaluation-1/review', { return: true }, {
      headers: { 'If-Match': '"3"' },
    }));
  }, 10_000);

  it('lets an all-scope administrator reopen a reviewed row with a required reason', async () => {
    useAuthStore.setState({
      user: {
        id: 'member-1', username: 'admin', email: null, role: '管理员', roleIds: [],
        permissions: { evaluations: ['read'], tasks: ['read', 'update'] },
        permissionScopes: { tasks: { update: 'all' } }, departmentIds: [], mustChangePassword: false, isGlobalAdmin: false,
      },
    });
    const baseGet = vi.mocked(apiClient.get).getMockImplementation()!;
    vi.mocked(apiClient.get).mockImplementation(async (url, config) => {
      if (url === '/tasks/task-1/evaluations') return {
        data: {
          items: [{
            id: 'evaluation-1', sequenceNumber: 'A.1', controlPoint: '身份鉴别', controlDomain: '访问控制',
            templateDataSnapshot: { sequenceNumber: 'A.1', controlPoint: '身份鉴别' },
            workflowStatus: 'reviewed', complianceStatus: 'compliant', assignedTo: 'member-2',
            assignee: { userId: 'member-2', displayName: '填写人' }, reviewClaimedBy: 'member-1',
            currentStatusDescription: '已完成检查', assets: [], evidenceFiles: [], historyCount: 0, lockVersion: 5,
          }],
          pagination: { page: 1, pageSize: 100, total: 1 }, summary: { unfilteredTotal: 1 },
        },
      } as any;
      return baseGet(url, config);
    });
    vi.mocked(apiClient.post).mockResolvedValue({ data: {} } as any);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/assessments/task-1/workbench']}>
        <Routes><Route path="/assessments/:id/workbench" element={<EvaluationWorkbench />} /></Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: /撤销复核/ }));
    const reason = await screen.findByRole('textbox', { name: '撤销复核原因' });
    expect(reason.parentElement?.parentElement).toHaveStyle({ paddingBottom: '22px' });
    expect(screen.getByRole('button', { name: '确认撤销' })).toBeDisabled();
    await user.type(reason, '证据引用错误');
    await user.click(screen.getByRole('button', { name: '确认撤销' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/evaluations/evaluation-1/reopen', { reason: '证据引用错误' }, {
      headers: { 'If-Match': '"5"' },
    }));
  }, 10_000);
});
