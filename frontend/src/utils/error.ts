/**
 * 从 API 错误中提取用户可读的提示信息
 */
export function getApiErrorMessage(err: any, fallback: string): string {
  return err?.error?.message || err?.message || (typeof err === 'string' ? err : fallback);
}
