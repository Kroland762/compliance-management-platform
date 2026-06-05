import { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../utils/http';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `接口不存在: ${req.method} ${req.originalUrl}` },
  });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
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

  const message = err instanceof Error ? err.message : '服务器内部错误';
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message },
  });
};
