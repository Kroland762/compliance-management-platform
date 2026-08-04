import { afterEach, describe, expect, test, vi } from 'vitest';
import dataSourceService from '../src/services/account/dataSource.service';
import { DataSource, DataSourceType } from '../src/models/account';
import auditLogService from '../src/services/audit-log.service';
import { decrypt, isEncryptedValue } from '../src/utils/crypto';

describe('active PostgreSQL data source security boundary', () => {
  const base = {
    dbType: 'postgres',
    host: '8.8.8.8',
    port: 5432,
    database: 'audit',
    username: 'readonly',
    password: 'StrongPassword!123',
    ssl: false,
    schema: 'public',
    table: 'users',
    allowedColumns: ['username'],
  };

  afterEach(() => vi.restoreAllMocks());

  test('encrypts credentials before persistence and masks them in responses', async () => {
    vi.spyOn(DataSource, 'create').mockImplementation(async (payload) => ({
      id: 'source-1',
      toJSON: () => ({ id: 'source-1', ...payload }),
    }));
    vi.spyOn(auditLogService, 'log').mockResolvedValue(undefined);

    const result = await dataSourceService.createDataSource({
      name: '只读审计库',
      sourceType: DataSourceType.DATABASE,
      connectionConfig: base,
      fieldMappingConfig: { accountId: 'username' },
    }, 'user-1');

    const persisted = DataSource.create.mock.calls[0][0].connectionConfig;
    expect(isEncryptedValue(persisted.password)).toBe(true);
    expect(decrypt(persisted.password)).toBe(base.password);
    expect(result.connectionConfig.password).toBe('******');
  });

  test('rejects arbitrary SQL and unsafe identifiers before any connection', async () => {
    await expect(dataSourceService.previewDbFields({ ...base, sql: 'DROP TABLE users' }))
      .rejects.toThrow(/不允许配置任意 SQL/);
    await expect(dataSourceService.previewDbFields({ ...base, table: 'users;drop table users' }))
      .rejects.toThrow(/普通标识符/);
  });

  test('blocks cloud metadata endpoints before any connection', async () => {
    await expect(dataSourceService.previewDbFields({ ...base, host: '169.254.169.254' }))
      .rejects.toThrow(/云元数据服务地址/);
  });

  test('rejects non-PostgreSQL data sources', async () => {
    await expect(dataSourceService.previewDbFields({ ...base, dbType: 'mysql' }))
      .rejects.toThrow(/仅支持 PostgreSQL/);
  });
});
