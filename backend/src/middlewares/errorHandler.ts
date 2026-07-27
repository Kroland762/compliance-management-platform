import { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../utils/http';
import { config } from '../config';
import logger from '../services/logger.service';
import ControlAuditEvent from '../models/ControlAuditEvent';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  500: 'INTERNAL_ERROR',
};

export const normalizeErrorResponses: RequestHandler = (_req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = ((body: any) => {
    if (!body?.error || res.statusCode < 400) return originalJson(body);
    const status = res.statusCode >= 500 ? 500 : res.statusCode;
    const preserveTenantCode = body.error.code === 'TENANT_CONTEXT_REQUIRED';
    const sensitive = /(sequelize|sql|select\s|insert\s|update\s.+set|delete\s+from|\/users\/|\/var\/|enoent|stack)/i
      .test(String(body.error.message || ''));
    const message = config.nodeEnv === 'production' && (status >= 500 || sensitive)
      ? (status >= 500 ? '服务器内部错误' : '请求处理失败')
      : body.error.message;
    return originalJson({
      ...body,
      error: {
        ...body.error,
        code: preserveTenantCode ? body.error.code : (CODE_BY_STATUS[status] || body.error.code),
        message,
        ...(config.nodeEnv === 'production' ? { stack: undefined } : {}),
      },
    });
  }) as typeof res.json;
  next();
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `接口不存在: ${req.method} ${req.originalUrl}` },
  });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    if (err.statusCode === 403) {
      void ControlAuditEvent.create({
        eventType: 'authorization.denied',
        actorUserId: req.user?.userId || null,
        tenantId: req.tenant?.id || null,
        resourceType: 'http_route',
        resourceId: req.originalUrl?.split('?')[0] || 'unknown',
        outcome: 'denied',
        details: { method: req.method, code: err.code },
        requestId: req.requestId || null,
      }).catch(() => undefined);
    }
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  logger.error('unhandled_error', {
    requestId: req.requestId,
    tenantId: req.tenant?.id || null,
    userId: req.user?.userId || null,
    errorName: err instanceof Error ? err.name : 'UnknownError',
    message: err instanceof Error ? err.message : 'unknown',
    ...(config.nodeEnv !== 'production' && err instanceof Error ? { stack: err.stack } : {}),
  });
  const message = config.nodeEnv === 'production' ? '服务器内部错误' : (err instanceof Error ? err.message : '服务器内部错误');
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message },
  });
};
