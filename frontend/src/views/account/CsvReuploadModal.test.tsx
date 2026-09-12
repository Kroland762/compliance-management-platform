import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataSourceApi, type CsvPreview, type DataSource } from '../../api/account';
import CsvReuploadModal from './CsvReuploadModal';

vi.mock('../../api/account', () => ({
  dataSourceApi: {
    previewCsv: vi.fn(),
    reuploadCsv: vi.fn(),
  },
}));

const savedMapping = {
  accountId: 'uid',
  mfaEnabled: { sourceField: 'mfa', convert: { Y: true, N: false } },
};

const source: DataSource = {
  id: 'csv-1',
  name: 'HR CSV',
  sourceType: 'CSV',
  fieldMappingConfig: savedMapping,
  mappingStatus: 'CONFIGURED',
  totalAccounts: 1,
  status: 'ACTIVE',
  lastSyncTime: '2026-08-20T00:00:00Z',
  createdAt: '2026-08-20T00:00:00Z',
  updatedAt: '2026-08-20T00:00:00Z',
};

function preview(status: CsvPreview['compatibility']['status'] = 'COMPATIBLE'): CsvPreview {
  return {
    file: { originalName: 'accounts.csv', size: 30, sha256: 'hash-1', encoding: 'UTF-8', delimiter: ',' },
    headers: status === 'COMPATIBLE' ? ['uid', 'mfa', 'extra'] : ['new_uid', 'mfa'],
    headerFingerprint: 'headers-1',
    rowCount: 1,
    sampleRows: status === 'COMPATIBLE' ? [{ accountId: '1', mfaEnabled: true }] : [],
    rawSampleRows: [{ uid: '1', mfa: 'Y' }],
    savedMapping,
    compatibility: {
      status,
      missingSourceFields: status === 'COMPATIBLE' ? [] : ['uid'],
      newSourceFields: status === 'COMPATIBLE' ? ['extra'] : ['new_uid'],
    },
    warnings: { blankAccountRows: [], duplicateAccountIds: [], duplicateAccountCount: 0 },
    changeSummary: { newCount: 1, reducedCount: 1, existingCount: 0 },
  };
}

describe('CsvReuploadModal', () => {
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

  it('restores the saved mapping, accepts a compatible file and preserves conversion objects', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    vi.mocked(dataSourceApi.previewCsv).mockResolvedValue({ data: preview() } as any);
    vi.mocked(dataSourceApi.reuploadCsv).mockResolvedValue({ data: { imported: 1, skipped: false } } as any);
    render(<CsvReuploadModal open source={source} onClose={onClose} onSuccess={onSuccess} />);

    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, new File(['uid,mfa\n1,Y'], 'accounts.csv', { type: 'text/csv' }));

    expect(await screen.findByText('映射兼容')).toBeInTheDocument();
    expect(dataSourceApi.previewCsv).toHaveBeenCalledWith(expect.any(File), {
      sourceId: 'csv-1',
      fieldMappingConfig: savedMapping,
    });
    const confirm = screen.getByRole('button', { name: '确认导入' });
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(dataSourceApi.reuploadCsv).toHaveBeenCalledWith(
      'csv-1',
      expect.any(File),
      expect.objectContaining({ fieldMappingConfig: savedMapping, expectedSha256: 'hash-1' }),
    ));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows schema drift and keeps confirmation disabled', async () => {
    const user = userEvent.setup();
    vi.mocked(dataSourceApi.previewCsv).mockResolvedValue({ data: preview('MAPPING_REQUIRED') } as any);
    render(<CsvReuploadModal open source={source} onClose={vi.fn()} onSuccess={vi.fn()} />);

    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, new File(['new_uid,mfa\n1,Y'], 'drift.csv', { type: 'text/csv' }));

    expect(await screen.findByText('缺少原字段：uid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认导入' })).toBeDisabled();
    expect(dataSourceApi.reuploadCsv).not.toHaveBeenCalled();
  });

  it('keeps the modal open after import failure and cancel does not mutate the saved mapping', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    vi.mocked(dataSourceApi.previewCsv).mockResolvedValue({ data: preview() } as any);
    vi.mocked(dataSourceApi.reuploadCsv).mockRejectedValue(new Error('import failed'));
    render(<CsvReuploadModal open source={source} onClose={onClose} onSuccess={vi.fn()} />);

    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, new File(['uid,mfa\n1,Y'], 'accounts.csv', { type: 'text/csv' }));
    await user.click(await screen.findByRole('button', { name: '确认导入' }));
    await waitFor(() => expect(dataSourceApi.reuploadCsv).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /重新上传 CSV/ })).toBeInTheDocument();

    fireEvent.click(document.querySelector('.ant-modal-close') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(source.fieldMappingConfig).toEqual(savedMapping);
  });
});
