import { timingSafeEqual } from 'crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import cron from 'node-cron';
import { config } from './config';
import sequelize from './config/database';
import { setupAssociations } from './models/associations';
import './models/account/associations';
import './models';
import cronSchedulerService from './services/account/cronScheduler.service';
import auditLogService from './services/audit-log.service';
import { initializeTenantConnectionIsolation, runWithTenantContext } from './middlewares/tenant';
import { errorHandler, normalizeErrorResponses, notFoundHandler } from './middlewares/errorHandler';
import { observability } from './middlewares/observability';
import { metricsRegistry } from './services/metrics.service';
import { migrationChecksum } from './config/migrations/registry';
import migrations from './config/migrations/registry';
import { status as migrationStatus } from './config/migrations/runner';
import Tenant from './models/Tenant';
import logger from './services/logger.service';
import { registerRoutes } from './routes';

const INSECURE_JWT_SECRETS = new Set([
  'change-this-to-a-random-32-char-string',
  'dev-secret-do-not-use-in-prod',
]);
let associationsReady = false;

function validateProductionSecrets(): void {
  if (config.nodeEnv !== 'production') return;
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || INSECURE_JWT_SECRETS.has(process.env.JWT_SECRET)) {
    throw new Error('生产环境必须设置非占位 JWT_SECRET（至少32字符）');
  }
  if (!process.env.METRICS_TOKEN || process.env.METRICS_TOKEN.length < 24) {
    throw new Error('生产环境必须设置至少 24 字符的 METRICS_TOKEN');
  }
}

function validMetricsToken(value: string | undefined): boolean {
  if (config.nodeEnv !== 'production' && !process.env.METRICS_TOKEN) return true;
  const expected = Buffer.from(process.env.METRICS_TOKEN || '');
  const received = Buffer.from(value || '');
  return expected.length > 0 && expected.length === received.length && timingSafeEqual(expected, received);
}

export function createApp(): express.Application {
  validateProductionSecrets();
  initializeTenantConnectionIsolation();
  if (!associationsReady) {
    setupAssociations();
    associationsReady = true;
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(config.nodeEnv === 'production'
    ? helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
        },
      },
      hsts: { maxAge: 31_536_000, includeSubDomains: true },
    })
    : helmet());
  app.use(observability);
  app.use(cookieParser());
  app.use(cors({ origin: config.frontendUrl, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(normalizeErrorResponses);

  app.get('/api/health/live', async (_req, res) => {
    const started = process.hrtime.bigint();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const eventLoopLagMs = Number(process.hrtime.bigint() - started) / 1e6;
    const memory = process.memoryUsage();
    res.json({
      status: eventLoopLagMs < 1_000 ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      eventLoopLagMs: Math.round(eventLoopLagMs),
      memory: { heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, rss: memory.rss },
    });
  });

  const ready = async (_req: express.Request, res: express.Response) => {
    try {
      await sequelize.authenticate();
      const states = await migrationStatus();
      const invalid = states.filter((item) => !item.applied || item.checksumValid === false);
      const scheduler = cronSchedulerService.status();
      if (invalid.length || !scheduler.healthy) {
        res.status(503).json({ status: 'not_ready', database: 'connected', migrations: invalid, scheduler });
        return;
      }
      res.json({
        status: 'ok',
        database: 'connected',
        migrations: { applied: states.length, registry: migrations.map((item) => ({ id: item.id, checksum: migrationChecksum(item) })) },
        scheduler,
      });
    } catch {
      res.status(503).json({ status: 'not_ready', database: 'disconnected' });
    }
  };
  app.get('/api/health/ready', ready);
  app.get('/api/health', ready);
  app.get('/api/internal/metrics', async (req, res) => {
    if (!validMetricsToken(req.header('Authorization')?.replace(/^Bearer\s+/i, '') || req.header('X-Metrics-Token'))) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: '指标访问令牌无效' } });
      return;
    }
    res.setHeader('Content-Type', metricsRegistry.contentType);
    res.send(await metricsRegistry.metrics());
  });

  registerRoutes(app);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

export async function start(): Promise<void> {
  validateProductionSecrets();
  await sequelize.authenticate();
  await cronSchedulerService.initialize();
  const app = createApp();
  const server = app.listen(config.port, () => logger.info('server_started', { port: config.port }));

  cron.schedule('0 3 * * *', async () => {
    const tenants = await Tenant.findAll();
    for (const tenant of tenants) {
      await runWithTenantContext(
        { schema: tenant.schemaName, tenantId: tenant.id },
        () => auditLogService.cleanupExpired(),
      ).catch((error) => logger.error('audit_cleanup_failed', { tenantId: tenant.id, message: String(error) }));
    }
  });

  const shutdown = () => {
    cronSchedulerService.shutdown();
    server.close(() => {
      void sequelize.close().finally(() => process.exit(0));
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    logger.error('startup_failed', { message: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}

export default createApp;
