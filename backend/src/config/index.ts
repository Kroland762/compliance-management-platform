import dotenv from 'dotenv';
dotenv.config();

export function resolveIntegerEnv(
  name: string,
  fallback: number,
  { min, max }: { min: number; max: number },
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} 必须是整数`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须在 ${min}-${max} 之间`);
  }
  return value;
}

export function assertProductionFrontendUrl(rawUrl: string): void {
  let frontendUrl: URL;
  try {
    frontendUrl = new URL(rawUrl);
  } catch {
    throw new Error('生产环境 FRONTEND_URL 必须是有效的 HTTPS 地址');
  }
  if (frontendUrl.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(frontendUrl.hostname)) {
    throw new Error('生产环境 FRONTEND_URL 必须使用正式域名和 HTTPS');
  }
}

function resolveBusinessTimeZone(): string {
  const timeZone = process.env.BUSINESS_TIME_ZONE || 'Asia/Shanghai';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return timeZone;
  } catch {
    throw new Error(`无效的 BUSINESS_TIME_ZONE: ${timeZone}`);
  }
}

export const config = {
  port: resolveIntegerEnv('PORT', 3001, { min: 1, max: 65_535 }),
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: resolveIntegerEnv('DB_PORT', 5432, { min: 1, max: 65_535 }),
    database: process.env.DB_NAME || 'compliance_management_platform',
    username: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true',
  },
  jwt: {
    secret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-secret-do-not-use-in-prod'),
    expiresIn: resolveIntegerEnv('JWT_EXPIRES_IN', 1800, { min: 60, max: 86_400 }),
    refreshExpiresIn: resolveIntegerEnv('JWT_REFRESH_EXPIRES_IN', 86_400, { min: 300, max: 31_536_000 }),
  },
  upload: {
    dir: process.env.UPLOAD_DIR || 'uploads',
    maxFileSize: resolveIntegerEnv('MAX_FILE_SIZE', 52_428_800, { min: 1_024, max: 1_073_741_824 }),
  },
  storage: {
    driver: process.env.FILE_STORAGE_DRIVER || 'local',
    s3: {
      endpoint: process.env.S3_ENDPOINT || '',
      region: process.env.S3_REGION || '',
      bucket: process.env.S3_BUCKET || '',
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    },
  },
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  businessTimeZone: resolveBusinessTimeZone(),
  security: {
    trustProxyHops: resolveIntegerEnv('TRUST_PROXY_HOPS', 0, { min: 0, max: 5 }),
    allowPrivateDataSourceHosts: process.env.ALLOW_PRIVATE_DATASOURCE_HOSTS === 'true',
    scheduleTaskTimeoutMs: resolveIntegerEnv('SCHEDULE_TASK_TIMEOUT_MS', 600_000, { min: 1_000, max: 86_400_000 }),
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: resolveIntegerEnv('SMTP_PORT', 587, { min: 1, max: 65_535 }),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'noreply@example.com',
  },
};
