import { afterEach, describe, expect, it } from 'vitest';
import { assertProductionFrontendUrl, resolveIntegerEnv } from '../src/config';

describe('deployment configuration validation', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('accepts bounded integer environment values and rejects malformed values', () => {
    process.env.TEST_PORT = '443';
    expect(resolveIntegerEnv('TEST_PORT', 80, { min: 1, max: 65_535 })).toBe(443);

    process.env.TEST_PORT = '443x';
    expect(() => resolveIntegerEnv('TEST_PORT', 80, { min: 1, max: 65_535 })).toThrow('必须是整数');

    process.env.TEST_PORT = '70000';
    expect(() => resolveIntegerEnv('TEST_PORT', 80, { min: 1, max: 65_535 })).toThrow('必须在');
  });

  it('requires a public HTTPS frontend URL for production', () => {
    expect(() => assertProductionFrontendUrl('https://compliance.example.org')).not.toThrow();
    expect(() => assertProductionFrontendUrl('http://compliance.example.org')).toThrow('HTTPS');
    expect(() => assertProductionFrontendUrl('https://localhost')).toThrow('正式域名');
    expect(() => assertProductionFrontendUrl('not-a-url')).toThrow('有效的 HTTPS 地址');
  });
});
