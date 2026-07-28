import dotenv from 'dotenv';
dotenv.config();

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
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'compliance_management_platform',
    username: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true',
  },
  jwt: {
    secret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-secret-do-not-use-in-prod'),
    expiresIn: parseInt(process.env.JWT_EXPIRES_IN || '1800', 10),
    refreshExpiresIn: parseInt(process.env.JWT_REFRESH_EXPIRES_IN || '86400', 10),  // 24小时
  },
  upload: {
    dir: process.env.UPLOAD_DIR || 'uploads',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '52428800', 10),
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
    allowPrivateDataSourceHosts: process.env.ALLOW_PRIVATE_DATASOURCE_HOSTS === 'true',
    scheduleTaskTimeoutMs: parseInt(process.env.SCHEDULE_TASK_TIMEOUT_MS || '600000', 10),
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'noreply@example.com',
  },
};
