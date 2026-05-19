import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } },
  standardHeaders: true,
  legacyHeaders: false,
});

export const loginLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 分钟窗口
  max: 100,               // 最多 100 次登录尝试
  message: { success: false, error: { code: 'RATE_LIMITED', message: '登录操作过于频繁，请稍后再试' } },
  standardHeaders: true,
  legacyHeaders: false,
});
