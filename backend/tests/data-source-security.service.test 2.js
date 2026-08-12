import { describe, expect, test } from 'vitest';
import {
  assertAllowedHostAddress,
  assertSafeIdentifier,
  normalizeConnectionConfig,
  sanitizeConnectionConfig,
} from '../src/services/account/dataSource-security.service';
import { decrypt, isEncryptedValue } from '../src/utils/crypto';

describe('data source security service', () => {
  const base = {
    dbType: 'postgres', host: '10.20.30.40', port: 5432, database: 'audit', username: 'readonly',
    password: 'StrongPassword!123', ssl: false, schema: 'public', table: 'users',
  };

  test('encrypts credentials and never returns them from sanitized config', () => {
    const normalized = normalizeConnectionConfig(base);
    expect(isEncryptedValue(normalized.password)).toBe(true);
    expect(decrypt(normalized.password)).toBe(base.password);
    const sanitized = sanitizeConnectionConfig(normalized);
    expect(sanitized).not.toHaveProperty('password');
    expect(sanitized.hasPassword).toBe(true);
  });

  test('masked password preserves the existing encrypted credential', () => {
    const existing = normalizeConnectionConfig(base);
    const updated = normalizeConnectionConfig({ ...base, password: '******', table: 'accounts' }, existing);
    expect(updated.password).toBe(existing.password);
  });

  test('rejects arbitrary SQL and unsafe identifiers', () => {
    expect(() => normalizeConnectionConfig({ ...base, sql: 'DROP TABLE users' }))
      .toThrow(/不允许保存或执行自定义 SQL/);
    expect(() => assertSafeIdentifier('users;drop table users', '表名')).toThrow(/格式不安全/);
  });

  test('blocks loopback and cloud metadata endpoints', () => {
    expect(() => assertAllowedHostAddress('127.0.0.1')).toThrow(/禁止连接/);
    expect(() => assertAllowedHostAddress('169.254.169.254')).toThrow(/禁止连接/);
  });
});
