import { afterEach, describe, expect, test, vi } from 'vitest';
import sequelize from '../src/config/database';
import { AccountData, AuditRule, DataSource, DataSourceType } from '../src/models/account';
import auditLogService from '../src/services/audit-log.service';
import csvDataSourceService from '../src/services/account/csvDataSource.service';
import ruleEngineService from '../src/services/account/ruleEngine.service';

function csvFile(contents: string, name = 'accounts.csv'): Express.Multer.File {
  return csvBuffer(Buffer.from(contents, 'utf8'), name);
}

function csvBuffer(buffer: Buffer, name = 'accounts.csv'): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: 'text/csv',
    size: buffer.length,
    destination: '',
    filename: '',
    path: '',
    buffer,
    stream: undefined as any,
  };
}

describe('CSV account data source mapping reuse', () => {
  afterEach(() => vi.restoreAllMocks());

  test('parses RFC 4180 content, applies conversions and reports duplicate account ids', async () => {
    const result = await csvDataSourceService.preview(csvFile(
      'uid,name,mfa\n1,"Alice\nAdmin",Y\n1,Bob,N',
    ), {
      accountId: 'uid',
      accountName: 'name',
      mfaEnabled: { sourceField: 'mfa', convert: { Y: true, N: false } },
    });

    expect(result.compatibility.status).toBe('COMPATIBLE');
    expect(result.rowCount).toBe(2);
    expect(result.sampleRows[0]).toMatchObject({ accountId: '1', accountName: 'Alice\nAdmin', mfaEnabled: true });
    expect(result.warnings.duplicateAccountCount).toBe(1);
  });

  test('does not accept duplicate headers or an incompatible saved mapping', async () => {
    await expect(csvDataSourceService.preview(csvFile('uid,uid\n1,A'), { accountId: 'uid' }))
      .rejects.toMatchObject({ code: 'INVALID_HEADERS' });

    const result = await csvDataSourceService.preview(csvFile('new_uid,name\n1,A'), { accountId: 'old_uid' });
    expect(result.compatibility).toMatchObject({ status: 'MAPPING_REQUIRED', missingSourceFields: ['old_uid'] });
  });

  test('detects UTF-8 BOM, GB18030 and supported delimiters', async () => {
    const utf8 = await csvDataSourceService.preview(csvFile('\ufeffuid\tname\n1\t张三'), { accountId: 'uid' });
    expect(utf8.file).toMatchObject({ encoding: 'UTF-8', delimiter: '\t' });

    const gb18030 = await csvDataSourceService.preview(csvBuffer(Buffer.concat([
      Buffer.from('uid;name\n1;', 'ascii'),
      Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
    ])), { accountId: 'uid', accountName: 'name' });
    expect(gb18030.file).toMatchObject({ encoding: 'GB18030', delimiter: ';' });
    expect(gb18030.sampleRows[0]).toMatchObject({ accountName: '中文' });
  });

  test('rejects binary content and more than 10,000 data rows', async () => {
    await expect(csvDataSourceService.preview(csvBuffer(Buffer.from([0x75, 0x69, 0x64, 0x0a, 0x00]))))
      .rejects.toMatchObject({ code: 'INVALID_CSV' });

    const oversized = ['uid', ...Array.from({ length: 10_001 }, (_, index) => String(index + 1))].join('\n');
    await expect(csvDataSourceService.preview(csvFile(oversized), { accountId: 'uid' }))
      .rejects.toMatchObject({ code: 'ROW_LIMIT_EXCEEDED' });
  });

  test('creates a CSV source and persists only metadata plus the mapped account batch', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } };
    vi.spyOn(sequelize, 'transaction').mockImplementation(async (callback: any) => callback(transaction));
    vi.spyOn(auditLogService, 'log').mockResolvedValue(undefined);
    vi.spyOn(AccountData, 'destroy').mockResolvedValue(0);
    vi.spyOn(AccountData, 'update').mockResolvedValue([0]);
    const bulkCreate = vi.spyOn(AccountData, 'bulkCreate').mockResolvedValue([] as any);
    const update = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(DataSource, 'create').mockResolvedValue({ id: 'source-1', update } as any);

    const file = csvFile('uid,name\n1,Alice\n2,Bob');
    const preview = await csvDataSourceService.preview(file, { accountId: 'uid', accountName: 'name' });
    const result = await csvDataSourceService.createAndImport(file, {
      name: 'HR 系统',
      fieldMappingConfig: { accountId: 'uid', accountName: 'name' },
      expectedSha256: preview.file.sha256,
    }, 'user-1');

    expect(result).toMatchObject({ sourceId: 'source-1', imported: 2, totalAccounts: 2 });
    expect(bulkCreate.mock.calls[0][0]).toHaveLength(2);
    const saved = update.mock.calls[0][0];
    expect(saved.csvConfig).toMatchObject({ originalName: 'accounts.csv', rowCount: 2, sha256: preview.file.sha256 });
    expect(saved.csvConfig).not.toHaveProperty('filePath');
  });

  test('rejects blank account ids before any database transaction starts', async () => {
    const transaction = vi.spyOn(sequelize, 'transaction');
    const file = csvFile('uid,name\n,Alice');
    const preview = await csvDataSourceService.preview(file, { accountId: 'uid' });
    await expect(csvDataSourceService.createAndImport(file, {
      name: 'HR 系统',
      fieldMappingConfig: { accountId: 'uid' },
      expectedSha256: preview.file.sha256,
    })).rejects.toMatchObject({ code: 'MISSING_ACCOUNT_ID' });
    expect(transaction).not.toHaveBeenCalled();
  });

  test('requires the preview hash and rejects a changed file before opening a transaction', async () => {
    const transaction = vi.spyOn(sequelize, 'transaction');
    const file = csvFile('uid\n1');
    await expect(csvDataSourceService.createAndImport(file, {
      name: 'HR 系统',
      fieldMappingConfig: { accountId: 'uid' },
    })).rejects.toMatchObject({ code: 'PREVIEW_REQUIRED' });
    await expect(csvDataSourceService.createAndImport(file, {
      name: 'HR 系统',
      fieldMappingConfig: { accountId: 'uid' },
      expectedSha256: 'different-hash',
    })).rejects.toMatchObject({ code: 'FILE_CHANGED' });
    expect(transaction).not.toHaveBeenCalled();
  });

  test('skips a byte-identical reupload while preserving the source id', async () => {
    const file = csvFile('uid,name\n1,Alice');
    const preview = await csvDataSourceService.preview(file, { accountId: 'uid' });
    const transaction = { LOCK: { UPDATE: 'UPDATE' } };
    vi.spyOn(sequelize, 'transaction').mockImplementation(async (callback: any) => callback(transaction));
    vi.spyOn(auditLogService, 'log').mockResolvedValue(undefined);
    vi.spyOn(DataSource, 'findByPk').mockResolvedValue({
      id: 'source-1',
      sourceType: DataSourceType.CSV,
      fieldMappingConfig: { accountId: 'uid' },
      csvConfig: { sha256: preview.file.sha256 },
      totalAccounts: 1,
      lastSyncTime: new Date(),
    } as any);
    const bulkCreate = vi.spyOn(AccountData, 'bulkCreate');

    const result = await csvDataSourceService.reimport('source-1', file, {
      expectedSha256: preview.file.sha256,
    }, 'user-1');

    expect(result).toMatchObject({ sourceId: 'source-1', skipped: true, imported: 0 });
    expect(bulkCreate).not.toHaveBeenCalled();
  });

  test('reimports a byte-identical file when the effective mapping changes', async () => {
    const file = csvFile('uid,name\n1,Alice');
    const preview = await csvDataSourceService.preview(file, { accountId: 'uid', accountName: 'name' });
    const transaction = { LOCK: { UPDATE: 'UPDATE' } };
    vi.spyOn(sequelize, 'transaction').mockImplementation(async (callback: any) => callback(transaction));
    vi.spyOn(auditLogService, 'log').mockResolvedValue(undefined);
    vi.spyOn(AccountData, 'destroy').mockResolvedValue(0);
    vi.spyOn(AccountData, 'update').mockResolvedValue([0]);
    const bulkCreate = vi.spyOn(AccountData, 'bulkCreate').mockResolvedValue([] as any);
    const update = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(DataSource, 'findByPk').mockResolvedValue({
      id: 'source-1',
      sourceType: DataSourceType.CSV,
      fieldMappingConfig: { accountId: 'uid' },
      csvConfig: { sha256: preview.file.sha256 },
      totalAccounts: 1,
      lastSyncTime: new Date(),
      update,
    } as any);

    const result = await csvDataSourceService.reimport('source-1', file, {
      fieldMappingConfig: { accountId: 'uid', accountName: 'name' },
      expectedSha256: preview.file.sha256,
    }, 'user-1');

    expect(result).toMatchObject({ sourceId: 'source-1', skipped: false, imported: 1 });
    expect(bulkCreate).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      fieldMappingConfig: { accountId: 'uid', accountName: 'name' },
    }), expect.anything());
  });

  test('keeps all tier mutations in one transaction and does not finalize the source after an import failure', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } };
    vi.spyOn(sequelize, 'transaction').mockImplementation(async (callback: any) => callback(transaction));
    vi.spyOn(auditLogService, 'log').mockResolvedValue(undefined);
    const destroy = vi.spyOn(AccountData, 'destroy').mockResolvedValue(0);
    const tierUpdate = vi.spyOn(AccountData, 'update').mockResolvedValue([0]);
    vi.spyOn(AccountData, 'bulkCreate').mockRejectedValue(new Error('bulk insert failed'));
    const sourceUpdate = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(DataSource, 'findByPk').mockResolvedValue({
      id: 'source-1',
      sourceType: DataSourceType.CSV,
      fieldMappingConfig: { accountId: 'uid' },
      csvConfig: { sha256: 'older-file' },
      update: sourceUpdate,
    } as any);

    const file = csvFile('uid\n1');
    const preview = await csvDataSourceService.preview(file, { accountId: 'uid' });
    await expect(csvDataSourceService.reimport('source-1', file, { expectedSha256: preview.file.sha256 }, 'user-1'))
      .rejects.toThrow('bulk insert failed');

    expect(destroy).toHaveBeenCalledWith(expect.objectContaining({ transaction }));
    expect(tierUpdate).toHaveBeenCalledTimes(2);
    expect(tierUpdate.mock.calls.every(([, options]) => options.transaction === transaction)).toBe(true);
    expect(sourceUpdate).not.toHaveBeenCalled();
  });

  test('scopes rule evaluation to the selected system when account ids overlap', async () => {
    const accountLookup = vi.spyOn(AccountData, 'findAll').mockResolvedValue([]);
    vi.spyOn(AuditRule, 'findAll').mockResolvedValue([]);

    await ruleEngineService.evaluateBatch(['shared-user'], ['rule-1'], 'source-1');

    expect(accountLookup).toHaveBeenCalledWith(expect.objectContaining({
      where: { accountId: expect.anything(), sourceId: 'source-1' },
    }));
  });
});
