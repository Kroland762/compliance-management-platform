/**
 * 密码复杂度校验
 * 要求: 最少 8 位, 必须包含大写字母、小写字母、数字、特殊字符
 */
export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (!password || password.length < 8) {
    errors.push('密码长度不能少于 8 位');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('必须包含至少一个小写字母');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('必须包含至少一个大写字母');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('必须包含至少一个数字');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
    errors.push('必须包含至少一个特殊字符（如 !@#$% 等）');
  }

  return { valid: errors.length === 0, errors };
}
