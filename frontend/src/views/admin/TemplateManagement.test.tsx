import { App as AntApp } from 'antd';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import TemplateManagement from './TemplateManagement';

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const legacyColumnSchema = [
  { key: 'sequenceNumber', label: '序号', source: 'core', visible: true, width: 140 },
  { key: 'controlDomain', label: '控制域名', source: 'core', visible: true, width: 240 },
  { key: 'controlPoint', label: '控制点', source: 'core', visible: true, width: 320 },
  { key: 'referenceAnswer', label: '参考回答', source: 'core', visible: true, width: 240 },
];

describe('TemplateManagement evaluation layout', () => {
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
    vi.mocked(apiClient.get).mockImplementation(async (url) => {
      if (url === '/templates') return {
        data: { items: [{ id: 'template-1', name: 'ISO 示例', questionCount: 1, version: '1.0' }] },
      } as any;
      if (url === '/templates/template-1') return {
        data: {
          id: 'template-1',
          name: 'ISO 示例',
          columnSchema: legacyColumnSchema,
          templateQuestions: [{ id: 'question-1', sequenceNumber: 'A.1', controlDomain: '访问控制', controlPoint: '身份鉴别' }],
        },
      } as any;
      throw new Error(`unexpected GET ${url}`);
    });
    vi.mocked(apiClient.put).mockImplementation(async (_url, body: any) => ({ data: body.columns }) as any);
  });

  it('reorders columns directly in the preview and persists the visible result', async () => {
    const user = userEvent.setup();
    render(<AntApp><TemplateManagement /></AntApp>);

    await screen.findByText('ISO 示例');
    await user.click(screen.getByRole('button', { name: /详情/ }));
    await screen.findByRole('dialog', { name: '模板详情' });
    expect(screen.getAllByText('关联资产').length).toBeGreaterThan(0);
    expect(screen.getAllByText('现状说明').length).toBeGreaterThan(0);
    expect(screen.queryByText('参考回答')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /列设置/ })).not.toBeInTheDocument();

    const previewHeader = document.querySelector('.template-preview-table .ant-table-thead');
    expect(previewHeader).not.toBeNull();
    const headerLabels = () => within(previewHeader as HTMLElement).getAllByRole('columnheader')
      .map((cell) => cell.querySelector('.template-column-header-label')?.textContent || '');
    expect(headerLabels()).toEqual([
      '序号', '评估点与要求', '关联资产', '责任人', '现状说明', '控制域名',
      '本次证据', '历史回答与证据', '符合性结论', '不符合项描述', '严重度', '状态', '流程操作',
    ]);

    expect(screen.getByRole('button', { name: '右移 序号' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '左移 关联资产' }));
    await user.click(screen.getByRole('button', { name: '左移 关联资产' }));
    expect(headerLabels()).toEqual([
      '关联资产', '序号', '评估点与要求', '责任人', '现状说明', '控制域名',
      '本次证据', '历史回答与证据', '符合性结论', '不符合项描述', '严重度', '状态', '流程操作',
    ]);
    expect(screen.getByRole('button', { name: '左移 关联资产' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /保存列配置/ }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1));
    const [, payload] = vi.mocked(apiClient.put).mock.calls[0];
    expect((payload as any).columns.map((column: any) => column.key)).toEqual([
      'assets', 'sequenceNumber', 'controlPoint', 'assignee', 'answer', 'controlDomain',
      'evidence', 'history', 'compliance', 'findingDescription', 'findingSeverity', 'status', 'actions',
    ]);
  });
});
