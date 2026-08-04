const { parsePagination } = require('../src/utils/pagination');
const { validateEvidence } = require('../src/services/evidence-security.service');
const dataSourceService = require('../src/services/account/dataSource.service').default;
const { getQualificationStatus } = require('../src/services/qualification.service');

describe('P0 security foundations', () => {
  test('pagination enforces page >= 1 and pageSize <= 100', () => {
    expect(parsePagination({ page: '1', pageSize: '100' })).toEqual({ page: 1, pageSize: 100 });
    expect(() => parsePagination({ page: 0, pageSize: 20 })).toThrow('page');
    expect(() => parsePagination({ page: 1, pageSize: 101 })).toThrow('pageSize');
  });

  test('evidence requires extension, MIME and signature to agree', () => {
    const pdf = Buffer.from('%PDF-1.7\\ncontent');
    const accepted = validateEvidence({
      originalname: 'evidence.pdf',
      mimetype: 'application/pdf',
      buffer: pdf,
      size: pdf.length,
    }, 'tenant-a');
    expect(accepted.storageKey).toMatch(/^tenant-a\/evidence\/.+\.pdf$/);
    expect(accepted.sha256).toHaveLength(64);

    expect(() => validateEvidence({
      originalname: 'renamed.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('MZ executable'),
      size: 13,
    }, 'tenant-a')).toThrow('文件扩展名、MIME 类型或文件签名不一致');
  });

  test('account data sources reject CSV and arbitrary SQL', async () => {
    await expect(dataSourceService.createDataSource({
      name: 'csv',
      sourceType: 'CSV',
    })).rejects.toThrow('仅允许创建 PostgreSQL');

    await expect(dataSourceService.createDataSource({
      name: 'unsafe',
      sourceType: 'DATABASE',
      connectionConfig: {
        dbType: 'postgres',
        host: 'db.example.test',
        port: 5432,
        database: 'accounts',
        username: 'reader',
        table: 'users',
        allowedColumns: ['id'],
        sql: 'DELETE FROM users',
      },
    })).rejects.toThrow('不允许配置任意 SQL');

    await expect(dataSourceService.createDataSource({
      name: 'metadata',
      sourceType: 'DATABASE',
      connectionConfig: {
        dbType: 'postgres',
        host: '::ffff:169.254.169.254',
        port: 5432,
        database: 'accounts',
        username: 'reader',
        table: 'users',
        allowedColumns: ['id'],
      },
    })).rejects.toThrow('不允许连接云元数据服务地址');

    expect(dataSourceService.isBlockedIp('169.254.169.254', true)).toBe(true);
    expect(dataSourceService.isBlockedIp('::ffff:169.254.169.254', true)).toBe(true);
    expect(dataSourceService.isBlockedIp('0:0:0:0:0:ffff:a9fe:a9fe', true)).toBe(true);
    expect(dataSourceService.isBlockedIp('fd00:ec2::254', true)).toBe(true);
    expect(dataSourceService.isBlockedIp('fe80::a9fe:a9fe', true)).toBe(true);
    expect(dataSourceService.isBlockedIp('::ffff:127.0.0.1', true)).toBe(true);
    expect(dataSourceService.isBlockedIp('10.0.0.10', true)).toBe(false);
    expect(dataSourceService.isBlockedIp('10.0.0.10', false)).toBe(true);
  });

  test('qualification status uses the configured business calendar without host timezone rollover', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-27T00:30:00+08:00'));
    expect(getQualificationStatus('2026-07-26')).toBe('expired');
    expect(getQualificationStatus('2026-07-27')).toBe('expiring');
    expect(getQualificationStatus('2026-09-01')).toBe('valid');
    expect(getQualificationStatus(null)).toBe('missing');
    jest.useRealTimers();
  });
});
