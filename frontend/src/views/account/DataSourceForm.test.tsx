import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataSourceApi } from '../../api/account';
import apiClient from '../../api/client';
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

vi.mock('../../api/client', () => ({
  default: {
    post: vi.fn(),
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
    await user.type(screen.getByLabelText('数据源名称'), 'HR CSV');
    await user.click(screen.getByLabelText('数据源类型'));
    fireEvent.click(screen.getByText('CSV 文件').closest('.ant-select-item-option') as HTMLElement);
    await user.click(screen.getByRole('button', { name: '下一步' }));

    await waitFor(() => expect(screen.getByText(/文件仅在内存中预览和导入/)).toBeInTheDocument());
    expect(screen.queryByLabelText('主机地址')).not.toBeInTheDocument();

    const file = new File(['uid,name\n1,Alice\n2,Bob'], 'accounts.csv', { type: 'text/csv' });
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);

    expect(dataSourceApi.previewCsv).toHaveBeenCalledWith(file);
    expect(await screen.findByText('UTF-8')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByRole('button', { name: /添加字段/ })).toBeVisible();
    expect(screen.getByRole('button', { name: '创建数据源' })).toBeVisible();
  });

  it('validates each step before moving forward', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><DataSourceForm /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByText('请输入名称')).toBeInTheDocument();
    expect(screen.getByLabelText('数据源名称')).toBeVisible();

    await user.type(screen.getByLabelText('数据源名称'), '生产账户库');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByLabelText('主机地址')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByText('请输入主机地址')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建数据源' })).not.toBeInTheDocument();
  });

  it('keeps the PostgreSQL create payload unchanged after completing all three steps', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockResolvedValue({ data: { columns: ['uid', 'display_name'] } } as any);
    vi.mocked(dataSourceApi.create).mockResolvedValue({ data: { id: 'db-1' } } as any);
    render(<MemoryRouter><DataSourceForm /></MemoryRouter>);

    await user.type(screen.getByLabelText('数据源名称'), '生产账户库');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.type(screen.getByLabelText('主机地址'), 'readonly-db.example.com');
    await user.type(screen.getByLabelText('数据库名'), 'accounts_db');
    await user.type(screen.getByLabelText('只读用户名'), 'accounts_reader');
    await user.type(screen.getByLabelText('密码'), 'secret');
    await user.type(screen.getByLabelText('只读表名'), 'accounts');
    await user.click(screen.getByRole('button', { name: '获取数据库字段' }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/account/data-sources/preview-fields', {
      dbType: 'postgres',
      host: 'readonly-db.example.com',
      port: 5432,
      database: 'accounts_db',
      username: 'accounts_reader',
      password: 'secret',
      schema: 'public',
      table: 'accounts',
      ssl: false,
    }));
    expect(await screen.findByText('检测到 2 个字段')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.mouseDown(screen.getByTestId('mapping-accountId').querySelector('.ant-select-selector') as HTMLElement);
    const uidOptions = await screen.findAllByText('uid');
    const uidOptionContent = uidOptions.find((element) => element.classList.contains('ant-select-item-option-content'));
    fireEvent.click(uidOptionContent?.closest('.ant-select-item-option') as HTMLElement);
    await user.click(screen.getByRole('button', { name: '创建数据源' }));

    await waitFor(() => expect(dataSourceApi.create).toHaveBeenCalledWith({
      name: '生产账户库',
      sourceType: 'DATABASE',
      fieldMappingConfig: { accountId: 'uid' },
      connectionConfig: {
        dbType: 'postgres',
        host: 'readonly-db.example.com',
        port: 5432,
        database: 'accounts_db',
        username: 'accounts_reader',
        password: 'secret',
        schema: 'public',
        table: 'accounts',
        allowedColumns: ['uid'],
        ssl: false,
      },
    }));
  });

  it('creates a MySQL read-only data source with the selected dialect and default port', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockResolvedValue({ data: { columns: ['uid', 'display_name'] } } as any);
    vi.mocked(dataSourceApi.create).mockResolvedValue({ data: { id: 'mysql-1' } } as any);
    render(<MemoryRouter><DataSourceForm /></MemoryRouter>);

    await user.type(screen.getByLabelText('数据源名称'), 'MySQL 账户库');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByLabelText('数据库类型'));
    fireEvent.click(screen.getByText('MySQL').closest('.ant-select-item-option') as HTMLElement);
    await user.type(screen.getByLabelText('主机地址'), 'mysql-readonly.example.com');
    await user.type(screen.getByLabelText('数据库名'), 'accounts_db');
    await user.type(screen.getByLabelText('只读用户名'), 'accounts_reader');
    await user.type(screen.getByLabelText('密码'), 'secret');
    await user.type(screen.getByLabelText('只读表名'), 'accounts');
    await user.click(screen.getByRole('button', { name: '获取数据库字段' }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/account/data-sources/preview-fields', {
      dbType: 'mysql',
      host: 'mysql-readonly.example.com',
      port: 3306,
      database: 'accounts_db',
      username: 'accounts_reader',
      password: 'secret',
      schema: undefined,
      table: 'accounts',
      ssl: false,
    }));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.mouseDown(screen.getByTestId('mapping-accountId').querySelector('.ant-select-selector') as HTMLElement);
    const uidOptions = await screen.findAllByText('uid');
    const uidOptionContent = uidOptions.find((element) => element.classList.contains('ant-select-item-option-content'));
    fireEvent.click(uidOptionContent?.closest('.ant-select-item-option') as HTMLElement);
    await user.click(screen.getByRole('button', { name: '创建数据源' }));

    await waitFor(() => expect(dataSourceApi.create).toHaveBeenCalledWith({
      name: 'MySQL 账户库',
      sourceType: 'DATABASE',
      fieldMappingConfig: { accountId: 'uid' },
      connectionConfig: {
        dbType: 'mysql',
        host: 'mysql-readonly.example.com',
        port: 3306,
        database: 'accounts_db',
        username: 'accounts_reader',
        password: 'secret',
        schema: undefined,
        table: 'accounts',
        allowedColumns: ['uid'],
        ssl: false,
      },
    }));
  });

  it('preserves an existing CSV mapping through the modal edit steps and original update protocol', async () => {
    const user = userEvent.setup();
    const editingDataSource = {
      id: 'csv-1',
      name: 'HR CSV',
      sourceType: 'CSV' as const,
      mappingStatus: 'CONFIGURED',
      totalAccounts: 2,
      status: 'ACTIVE',
      lastSyncTime: null,
      createdAt: '2026-08-20T00:00:00Z',
      updatedAt: '2026-08-20T00:00:00Z',
      csvConfig: { headers: ['uid', 'name'] },
      fieldMappingConfig: { accountId: 'uid', accountName: 'name' },
    };
    vi.mocked(dataSourceApi.update).mockResolvedValue({ data: editingDataSource } as any);

    render(
      <MemoryRouter>
        <DataSourceForm open editingDataSource={editingDataSource} onClose={vi.fn()} onSuccess={vi.fn()} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('dialog', { name: '编辑数据源' })).toBeInTheDocument();
    expect(screen.getByLabelText('数据源名称')).toHaveValue('HR CSV');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(screen.getByText(/此处仅维护名称和字段映射/)).toBeVisible());
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByTestId('mapping-accountId')).toHaveTextContent('uid');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => expect(dataSourceApi.update).toHaveBeenCalledWith('csv-1', {
      name: 'HR CSV',
      fieldMappingConfig: { accountId: 'uid', accountName: 'name' },
    }));
  });
});
