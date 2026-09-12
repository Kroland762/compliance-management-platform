import { afterEach, describe, expect, test, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import dataSourceService from '../src/services/account/dataSource.service';
import { DataSource, DataSourceType } from '../src/models/account';
import auditLogService from '../src/services/audit-log.service';
import { decrypt, isEncryptedValue } from '../src/utils/crypto';

describe('active database data source security boundary', () => {
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

  test('accepts every supported database dialect without weakening persistence masking', async () => {
    const create = vi.spyOn(DataSource, 'create').mockImplementation(async (payload) => ({
      id: `source-${payload.connectionConfig.dbType}`,
      toJSON: () => ({ id: `source-${payload.connectionConfig.dbType}`, ...payload }),
    }));
    vi.spyOn(auditLogService, 'log').mockResolvedValue(undefined);

    const configs = [
      { ...base, dbType: 'postgres', port: 5432, schema: 'public' },
      { ...base, dbType: 'mysql', port: 3306, schema: undefined },
      { ...base, dbType: 'mssql', port: 1433, schema: 'dbo' },
      { ...base, dbType: 'oracle', port: 1521, schema: 'APP_OWNER' },
      { dbType: 'sqlite', database: '/tmp/accounts.sqlite', table: 'users', allowedColumns: ['username'] },
    ];

    for (const connectionConfig of configs) {
      await expect(dataSourceService.createDataSource({
        name: `${connectionConfig.dbType} source`,
        sourceType: DataSourceType.DATABASE,
        connectionConfig,
        fieldMappingConfig: { accountId: 'username' },
      }, 'user-1')).resolves.toMatchObject({ connectionConfig: { dbType: connectionConfig.dbType } });
    }

    expect(create).toHaveBeenCalledTimes(configs.length);
  });

  test('generates dialect-specific column discovery queries', async () => {
    const cases = [
      {
        dialect: 'postgres',
        config: { ...base, dbType: 'postgres', schema: 'public', table: 'users' },
        row: { column_name: 'uid' },
        sql: /information_schema\.columns/i,
        replacements: { table: 'users', schema: 'public', database: 'audit', limit: 5 },
      },
      {
        dialect: 'mysql',
        config: { ...base, dbType: 'mysql', schema: undefined, table: 'users' },
        row: { COLUMN_NAME: 'uid' },
        sql: /INFORMATION_SCHEMA\.COLUMNS/,
        replacements: { table: 'users', schema: undefined, database: 'audit', limit: 5 },
      },
      {
        dialect: 'mssql',
        config: { ...base, dbType: 'mssql', schema: 'dbo', table: 'users' },
        row: { COLUMN_NAME: 'uid' },
        sql: /SELECT TOP 5 COLUMN_NAME/,
        replacements: { table: 'users', schema: 'dbo', database: 'audit', limit: 5 },
      },
      {
        dialect: 'oracle',
        config: { ...base, dbType: 'oracle', schema: 'APP_OWNER', table: 'users' },
        row: { COLUMN_NAME: 'UID' },
        sql: /ALL_TAB_COLUMNS/,
        replacements: { table: 'USERS', schema: 'APP_OWNER', database: 'audit', limit: 5 },
      },
      {
        dialect: 'sqlite',
        config: { dbType: 'sqlite', database: '/tmp/accounts.sqlite', table: 'users' },
        row: { name: 'uid' },
        sql: /PRAGMA table_info\(`users`\)/,
        replacements: {},
      },
    ];

    for (const item of cases) {
      const conn = { query: vi.fn().mockResolvedValue([[item.row]]) };
      await expect(dataSourceService.getDatabaseColumns(conn, item.config, item.dialect, 5))
        .resolves.toEqual([item.dialect === 'oracle' ? 'UID' : 'uid']);
      const [sql, options] = conn.query.mock.calls[0];
      expect(sql).toMatch(item.sql);
      expect(options.replacements).toEqual(item.replacements);
    }
  });

  test('generates read-only whitelist SELECT SQL for every supported dialect', () => {
    expect(dataSourceService.selectRowsSql(
      { dbType: 'postgres', schema: 'public', table: 'users' },
      'postgres',
      ['uid', 'display_name'],
      10,
    )).toBe('SELECT "uid", "display_name" FROM "public"."users" LIMIT 10');
    expect(dataSourceService.selectRowsSql(
      { dbType: 'mysql', table: 'users' },
      'mysql',
      ['uid', 'display_name'],
      10,
    )).toBe('SELECT `uid`, `display_name` FROM `users` LIMIT 10');
    expect(dataSourceService.selectRowsSql(
      { dbType: 'mssql', schema: 'dbo', table: 'users' },
      'mssql',
      ['uid', 'display_name'],
      10,
    )).toBe('SELECT TOP 10 [uid], [display_name] FROM [dbo].[users]');
    expect(dataSourceService.selectRowsSql(
      { dbType: 'oracle', schema: 'APP_OWNER', table: 'users' },
      'oracle',
      ['uid', 'display_name'],
      10,
    )).toBe('SELECT "UID", "DISPLAY_NAME" FROM "APP_OWNER"."USERS" FETCH FIRST 10 ROWS ONLY');
    expect(dataSourceService.selectRowsSql(
      { dbType: 'sqlite', table: 'users' },
      'sqlite',
      ['uid', 'display_name'],
      10,
    )).toBe('SELECT `uid`, `display_name` FROM `users` LIMIT 10');
  });

  test('rejects unsupported database dialects', async () => {
    await expect(dataSourceService.previewDbFields({ ...base, dbType: 'db2' }))
      .rejects.toThrow(/仅支持 PostgreSQL、MySQL、SQL Server、Oracle、SQLite 数据源/);
  });

  test('reads a SQLite source through the same field mapping and whitelist path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-sqlite-'));
    const dbPath = path.join(dir, 'accounts.sqlite');
    const db = new sqlite3.Database(dbPath);
    const run = (sql) => new Promise((resolve, reject) => db.run(sql, (error) => error ? reject(error) : resolve()));
    const close = () => new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
    try {
      await run('CREATE TABLE users (uid TEXT, display_name TEXT, mfa TEXT)');
      await run("INSERT INTO users (uid, display_name, mfa) VALUES ('u-1', 'Alice', 'yes')");
      await close();

      const rows = await dataSourceService.queryDatabase({
        dbType: 'sqlite',
        database: dbPath,
        table: 'users',
        allowedColumns: ['uid', 'display_name', 'mfa'],
      }, {
        accountId: 'uid',
        accountName: 'display_name',
        mfaEnabled: { sourceField: 'mfa', convert: { yes: 'true' } },
      });

      expect(rows).toEqual([expect.objectContaining({
        accountId: 'u-1',
        accountName: 'Alice',
        mfaEnabled: 'true',
      })]);
    } finally {
      if (db.open) await close().catch(() => undefined);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
