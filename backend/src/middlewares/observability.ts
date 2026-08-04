import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import logger from '../services/logger.service';
import { httpDuration } from '../services/metrics.service';
import AuditLog from '../models/AuditLog';
import { runWithTenantContext } from './tenant';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function observability(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - started) / 1e9;
    const route = req.route?.path
      ? `${req.baseUrl}${req.route.path}`
      : req.originalUrl.split('?')[0];
    httpDuration.observe({ method: req.method, route, status_code: String(res.statusCode) }, durationSeconds);
    logger.info('http_request', {
      requestId,
      method: req.method,
      route,
      statusCode: res.statusCode,
      tenantId: req.tenant?.id || null,
      userId: req.user?.userId || null,
      outcome: res.statusCode < 400 ? 'success' : 'failure',
      durationMs: Math.round(durationSeconds * 1000),
    });
    if (req.tenant) {
      void runWithTenantContext(
        {
          schema: req.tenant.schemaName,
          tenantId: req.tenant.id,
          requestId,
          userId: req.user?.userId || null,
          memberId: req.user?.memberId || null,
        },
        () => AuditLog.update(
          { durationMs: Math.round(durationSeconds * 1000) },
          { where: { requestId } },
        ),
      ).catch(() => undefined);
    }
  });
  next();
}
