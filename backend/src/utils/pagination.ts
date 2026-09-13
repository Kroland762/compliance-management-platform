import { AppError } from './http';

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function parsePagination(input: { page?: unknown; pageSize?: unknown }): { page: number; pageSize: number } {
  const page = Number(input.page ?? 1);
  const pageSize = Number(input.pageSize ?? 20);
  if (!Number.isInteger(page) || page < 1) {
    throw new AppError(400, 'VALIDATION_ERROR', 'page 必须是大于等于 1 的整数');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new AppError(400, 'VALIDATION_ERROR', 'pageSize 必须是 1 到 100 的整数');
  }
  return { page, pageSize };
}

export function pagination(page: number, pageSize: number, total: number): Pagination {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}
