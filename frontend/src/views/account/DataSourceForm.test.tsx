import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataSourceApi } from '../../api/account';
import DataSourceForm from './DataSourceForm';

vi.mock('../../api/account', () => ({
  dataSourceApi: {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    previewCsv: vi.fn(),
    uploadCsv: vi.fn(),
  },
}));

describe('DataSourceForm CSV flow', () => {
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
  });

  it('switches from PostgreSQL to CSV and previews the selected file through the backend', async () => {
    const user = userEvent.setup();
    vi.mocked(dataSourceApi.previewCsv).mockResolvedValue({
      data: {
        file: { originalName: 'accounts.csv', size: 20, sha256: 'hash-1', encoding: 'UTF-8', delimiter: ',' },
        headers: ['uid', 'name'],
        headerFingerprint: 'headers-1',
        rowCount: 2,
        sampleRows: [],
        rawSampleRows: [{ uid: '1', name: 'Alice' }],
        savedMapping: {},
        compatibility: { status: 'UNMAPPED', missingSourceFields: [], newSourceFields: ['uid', 'name'] },
        warnings: { blankAccountRows: [], duplicateAccountIds: [], duplicateAccountCount: 0 },
        changeSummary: { newCount: 0, reducedCount: 0, existingCount: 0 },
      },
    } as any);

    render(<MemoryRouter><DataSourceForm /></MemoryRouter>);
    await user.click(screen.getByLabelText('数据源类型'));
    fireEvent.click(screen.getByText('CSV 文件').closest('.ant-select-item-option') as HTMLElement);

    await waitFor(() => expect(screen.getByText(/文件仅在内存中预览和导入/)).toBeInTheDocument());
    expect(screen.queryByLabelText('主机地址')).not.toBeInTheDocument();

    const file = new File(['uid,name\n1,Alice\n2,Bob'], 'accounts.csv', { type: 'text/csv' });
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);

    expect(dataSourceApi.previewCsv).toHaveBeenCalledWith(file);
    expect(await screen.findByText('UTF-8')).toBeInTheDocument();
  });
});
