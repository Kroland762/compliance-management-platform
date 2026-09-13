import type { Request } from 'express';
import { AppError } from './http';

export function parseExpectedLockVersion(req: Request): number {
  const rawHeader = req.header('If-Match');
  const rawValue = rawHeader ?? req.body?.lockVersion;
  if (rawValue === undefined || rawValue === null
    || (typeof rawValue === 'string' && rawValue.trim() === '')) {
    throw new AppError(428, 'PRECONDITION_REQUIRED', '请刷新数据后重试');
  }
  const normalized = typeof rawValue === 'string'
    ? rawValue.trim().replace(/^W\//, '').replace(/^"|"$/g, '')
    : rawValue;
  const version = Number(normalized);
  if (!Number.isInteger(version) || version < 0) {
    throw new AppError(428, 'PRECONDITION_REQUIRED', '请刷新数据后重试');
  }
  return version;
}

export function assertLockVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new AppError(409, 'CONFLICT', '数据已被其他操作更新，请刷新后重试');
  }
}
