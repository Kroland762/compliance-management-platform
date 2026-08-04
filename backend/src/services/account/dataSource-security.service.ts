import dns from 'dns';
import net from 'net';
import { Sequelize } from 'sequelize';
import { config as appConfig } from '../../config';
import { decrypt, encrypt, isEncryptedValue } from '../../utils/crypto';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
const MASKED_SECRET = '******';

export interface SecureConnectionConfig {
  dbType: 'postgres';
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  schema: string;
  table?: string;
  connectTimeoutMs: number;
  statementTimeoutMs: number;
  maxRows: number;
}

export class DataSourceSecurityError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DataSourceSecurityError';
    this.code = code;
  }
}

function assertText(value: unknown, name: string, maxLength = 255): string {
  if (typeof value !== 'string' || !value.trim()) throw new DataSourceSecurityError('INVALID_CONFIG', `${name}不能为空`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new DataSourceSecurityError('INVALID_CONFIG', `${name}长度超限`);
  return normalized;
}

export function assertSafeIdentifier(value: unknown, name: string): string {
  const identifier = assertText(value, name, 63);
  if (!IDENTIFIER.test(identifier)) throw new DataSourceSecurityError('INVALID_IDENTIFIER', `${name}格式不安全`);
  return identifier;
}

export function assertAllowedHostAddress(address: string): void {
  const normalized = address.toLowerCase();
  if (['localhost', '0.0.0.0', '::', '::1', '169.254.169.254', 'metadata.google.internal'].includes(normalized)) {
    throw new DataSourceSecurityError('HOST_BLOCKED', '禁止连接本机、链路本地或云元数据地址');
  }
  if (net.isIPv4(normalized)) {
    const [a, b] = normalized.split('.').map(Number);
    if (a === 127 || a === 0 || (a === 169 && b === 254)) {
      throw new DataSourceSecurityError('HOST_BLOCKED', '禁止连接本机或链路本地地址');
    }
    const privateAddress = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    if (privateAddress && process.env.ALLOW_PRIVATE_DATA_SOURCES === 'false') {
      throw new DataSourceSecurityError('PRIVATE_HOST_BLOCKED', '当前环境禁止连接私有网络数据源');
    }
  }
}

export async function validateDataSourceHost(host: string): Promise<void> {
  assertAllowedHostAddress(host);
  if (net.isIP(host)) return;
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new DataSourceSecurityError('HOST_RESOLUTION_FAILED', '数据源主机无法解析');
  }
  if (addresses.length === 0) throw new DataSourceSecurityError('HOST_RESOLUTION_FAILED', '数据源主机无法解析');
  addresses.forEach(result => assertAllowedHostAddress(result.address));
}

export function normalizeConnectionConfig(input: any, existing?: any): SecureConnectionConfig {
  const requestedType = String(input?.dbType || input?.dialect || existing?.dbType || 'postgres').toLowerCase();
  if (!['postgres', 'postgresql'].includes(requestedType)) {
    throw new DataSourceSecurityError('UNSUPPORTED_DATABASE', '当前安全连接器仅支持 PostgreSQL');
  }

  const port = Number(input?.port ?? existing?.port ?? 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new DataSourceSecurityError('INVALID_CONFIG', '端口无效');
  const ssl = input?.ssl === undefined ? Boolean(existing?.ssl) : input.ssl === true;
  if (appConfig.nodeEnv === 'production' && !ssl && process.env.ALLOW_INSECURE_DATA_SOURCE_TLS !== 'true') {
    throw new DataSourceSecurityError('TLS_REQUIRED', '生产环境数据源必须启用 TLS');
  }

  let password = input?.password;
  if (password === undefined || password === '' || password === MASKED_SECRET) password = existing?.password;
  if (typeof password !== 'string' || !password) throw new DataSourceSecurityError('INVALID_CONFIG', '数据库密码不能为空');
  if (!isEncryptedValue(password)) password = encrypt(password);

  if (input?.sql !== undefined) {
    throw new DataSourceSecurityError('ARBITRARY_SQL_DISABLED', '不允许保存或执行自定义 SQL，请配置只读表和字段映射');
  }

  return {
    dbType: 'postgres',
    host: assertText(input?.host ?? existing?.host, '主机名'),
    port,
    database: assertText(input?.database ?? existing?.database, '数据库名', 128),
    username: assertText(input?.username ?? existing?.username, '用户名', 128),
    password,
    ssl,
    schema: assertSafeIdentifier(input?.schema ?? existing?.schema ?? 'public', 'Schema'),
    table: input?.table || existing?.table ? assertSafeIdentifier(input?.table ?? existing?.table, '表名') : undefined,
    connectTimeoutMs: Math.min(Math.max(Number(input?.connectTimeoutMs ?? existing?.connectTimeoutMs ?? 5000), 1000), 15000),
    statementTimeoutMs: Math.min(Math.max(Number(input?.statementTimeoutMs ?? existing?.statementTimeoutMs ?? 15000), 1000), 60000),
    maxRows: Math.min(Math.max(Number(input?.maxRows ?? existing?.maxRows ?? 10000), 1), 10000),
  };
}

export async function createSecureDataSourceConnection(input: SecureConnectionConfig): Promise<Sequelize> {
  await validateDataSourceHost(input.host);
  return new Sequelize(input.database, input.username, decrypt(input.password), {
    dialect: 'postgres',
    host: input.host,
    port: input.port,
    logging: false,
    pool: { max: 2, min: 0, acquire: input.connectTimeoutMs, idle: 1000 },
    dialectOptions: {
      connectTimeout: input.connectTimeoutMs,
      statement_timeout: input.statementTimeoutMs,
      application_name: 'compliance-platform-readonly-connector',
      ...(input.ssl ? {
        ssl: {
          require: true,
          rejectUnauthorized: true,
          ca: process.env.DATA_SOURCE_CA_CERT || undefined,
        },
      } : {}),
    },
  });
}

export function sanitizeConnectionConfig(input: any): Record<string, any> {
  const sanitized = { ...input, hasPassword: Boolean(input?.password) };
  delete sanitized.password;
  return sanitized;
}
