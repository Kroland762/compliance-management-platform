import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import FilePreviewModal from './FilePreviewModal';

vi.mock('../api/client', () => ({
  default: { get: vi.fn() },
}));

describe('FilePreviewModal', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('explains unsupported formats without requesting preview content', () => {
    render(
      <FilePreviewModal
        open
        file={{ id: 'file-1', originalFilename: 'evidence.docx', fileSize: 1024 }}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText('该格式暂不支持在线预览')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下载原文件/ })).toBeEnabled();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('renders paginated CSV data and the truncation notice', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        columns: ['姓名', '部门'],
        rows: [{ 姓名: '张三', 部门: '安全部' }],
        pagination: { page: 1, pageSize: 50, total: 1000, truncated: true },
        encoding: 'UTF-8',
        warnings: [],
      },
    });

    render(
      <FilePreviewModal
        open
        file={{ id: 'file-2', originalFilename: '证据.csv', mimeType: 'text/csv', fileSize: 2048 }}
        onClose={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByText('张三')).toBeInTheDocument());
    expect(screen.getByText('安全部')).toBeInTheDocument();
    expect(screen.getByText('当前展示前 1000 行，完整内容请下载查看')).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith('/evidence/file-2/preview', {
      params: { page: 1, pageSize: 50 },
    });
  });
});

