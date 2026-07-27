import { Router, Request, Response } from 'express';
import authService from '../services/auth.service';
import captchaService from '../services/captcha.service';
import { authenticate, authorize } from '../middlewares/auth';
import { loginLimiter } from '../middlewares/rateLimiter';
import { config } from '../config';
import { UserRole } from '../models';
import auditLogService from '../services/audit-log.service';
import { OperationType } from '../models';
import { loginFailures } from '../services/metrics.service';

const router = Router();

/**
 * GET /api/auth/captcha
 * 获取图形验证码
 */
router.get('/captcha', (_req: Request, res: Response) => {
  try {
    const { captchaId, svg } = captchaService.generate();
    res.json({ success: true, data: { captchaId, svg } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'CAPTCHA_FAILED', message: error.message } });
  }
});

/**
 * POST /api/auth/login
 */
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password, captchaId, captchaCode } = req.body;
    if (!username || !password) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: '用户名和密码为必填项' },
      });
      return;
    }
    const result = await authService.login(username, password, captchaId, captchaCode);
    // Refresh Token → HttpOnly Cookie
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: config.jwt.refreshExpiresIn * 1000,
      path: '/api/auth',
    });
    // Access Token + User → JSON body（前端存内存）
    res.json({
      success: true,
      data: { token: result.token, expiresIn: result.expiresIn, user: result.user },
    });
  } catch (error: any) {
    loginFailures.inc();
    res.status(401).json({
      success: false,
      error: { code: 'AUTH_FAILED', message: error.message },
    });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', authenticate, (_req: Request, res: Response) => {
  res.clearCookie('refreshToken', { path: '/api/auth' });
  res.json({ success: true, message: '已登出' });
});

/**
 * POST /api/auth/refresh
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      res.status(401).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: '刷新令牌缺失' },
      });
      return;
    }
    const result = await authService.refreshToken(refreshToken);
    // 刷新成功 → 更新 Cookie（滑动续期）
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: config.jwt.refreshExpiresIn * 1000,
      path: '/api/auth',
    });
    res.json({
      success: true,
      data: { token: result.token, expiresIn: result.expiresIn, user: result.user },
    });
  } catch (error: any) {
    res.status(401).json({
      success: false,
      error: { code: 'REFRESH_FAILED', message: error.message },
    });
  }
});

/**
 * GET /api/auth/me
 */
router.get('/me', authenticate, async (req: Request, res: Response) => {
  const { User } = await import('../models');
  const user = await User.findByPk(req.user!.userId);
  if (!user) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '用户不存在' } });
    return;
  }
  res.json({
    success: true,
    data: {
      id: user.id,
      username: user.username,
      role: user.role,
      department: user.department,
      email: user.email,
      lastLogin: user.lastLogin,
    },
  });
});

/**
 * POST /api/auth/change-password
 * 修改密码
 */
router.post('/change-password', authenticate, async (req: Request, res: Response) => {
  try {
    const { oldPassword, newPassword } = req.body;
    await authService.changePassword(req.user!.userId, oldPassword, newPassword);

    await auditLogService.log({
      userId: req.user!.userId,
      operationType: OperationType.UPDATE,
      resourceType: 'user',
      resourceId: req.user!.userId,
      operationDetails: '修改密码',
      success: true,
    });

    res.json({ success: true, message: '密码修改成功' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'CHANGE_PASSWORD_FAILED', message: error.message } });
  }
});

export default router;
