import { Router, Request, Response } from 'express';
import authService from '../services/auth.service';
import captchaService from '../services/captcha.service';
import { authenticate } from '../middlewares/auth';
import { captchaLimiter, loginLimiter } from '../middlewares/rateLimiter';
import { config } from '../config';
import { ControlAuditEvent, OperationType, Tenant, User } from '../models';
import { loginFailures } from '../services/metrics.service';
import authAuditService from '../services/auth-audit.service';
import logger from '../services/logger.service';
import { AppError, asyncHandler } from '../utils/http';
import memberService from '../services/member.service';
import { runWithTenantContext } from '../middlewares/tenant';

const router = Router();

function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: config.jwt.refreshExpiresIn * 1000,
    path: '/api/auth',
  });
}

function authResponse(result: Awaited<ReturnType<typeof authService.login>>) {
  return {
    token: result.token,
    expiresIn: result.expiresIn,
    user: result.user,
    status: result.status,
    contexts: result.contexts,
  };
}

/**
 * GET /api/auth/captcha
 * 获取图形验证码
 */
router.get('/captcha', captchaLimiter, (_req: Request, res: Response) => {
  try {
    const { captchaId, svg } = captchaService.generate();
    res.json({ success: true, data: { captchaId, svg } });
  } catch (error: any) {
    const status = error instanceof AppError ? error.statusCode : 500;
    const code = error instanceof AppError ? error.code : 'CAPTCHA_FAILED';
    res.status(status).json({ success: false, error: { code, message: error.message } });
  }
});

/**
 * POST /api/auth/login
 */
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const { username, password, captchaId, captchaCode } = req.body;
  try {
    if (!username || !password) {
      await authAuditService.record({
        operationType: OperationType.LOGIN,
        userId: null,
        success: false,
        details: '登录失败：缺少必填凭据',
        ipAddress: req.ip,
        requestId: req.requestId,
      });
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: '用户名和密码为必填项' },
      });
      return;
    }
    const result = await authService.login(username, password, captchaId, captchaCode);
    await authAuditService.record({
      operationType: OperationType.LOGIN,
      userId: result.user.id,
      tenantId: result.user.tenantId || null,
      success: true,
      details: '用户登录成功',
      ipAddress: req.ip,
      requestId: req.requestId,
    });
    setRefreshCookie(res, result.refreshToken);
    res.json({ success: true, data: authResponse(result) });
  } catch (error: any) {
    loginFailures.inc();
    try {
      const candidate = typeof username === 'string'
        ? await User.findOne({ where: { username }, attributes: ['id'] })
        : null;
      await authAuditService.record({
        operationType: OperationType.LOGIN,
        userId: candidate?.id || null,
        tenantId: null,
        success: false,
        details: '用户登录失败',
        ipAddress: req.ip,
        requestId: req.requestId,
      });
    } catch (auditError) {
      logger.error('login_audit_failed', {
        requestId: req.requestId,
        message: auditError instanceof Error ? auditError.message : String(auditError),
      });
    }
    res.status(401).json({
      success: false,
      error: { code: 'AUTH_FAILED', message: error.message },
    });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const revoked = await authService.revokeSession(accessToken, req.cookies?.refreshToken);
  try {
    if (revoked.userId) {
      await authAuditService.record({
        operationType: OperationType.LOGOUT,
        userId: revoked.userId,
        tenantId: revoked.tenantId || null,
        success: true,
        details: '用户登出',
        ipAddress: req.ip,
        requestId: req.requestId,
      });
    }
  } finally {
    res.clearCookie('refreshToken', { path: '/api/auth' });
  }
  res.json({ success: true, message: '已登出' });
}));

router.get('/contexts', authenticate, asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.user!.userId);
  if (!user) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '用户不存在' } });
    return;
  }
  res.json({ success: true, data: { items: await authService.contextsForUser(user) } });
}));

router.post('/context', authenticate, asyncHandler(async (req, res) => {
  const result = await authService.selectContext(
    req.user!.userId,
    String(req.body.tenantId || ''),
    req.user!.sessionId,
  );
  await ControlAuditEvent.create({
    eventType: 'tenant.context.selected',
    actorUserId: req.user!.userId,
    tenantId: result.user.tenantId || null,
    resourceType: 'tenant_context',
    resourceId: result.user.tenantId || null,
    outcome: 'success',
    details: { memberId: result.user.memberId || null },
    requestId: req.requestId || null,
  });
  setRefreshCookie(res, result.refreshToken);
  res.json({ success: true, data: authResponse(result) });
}));

router.delete('/context', authenticate, asyncHandler(async (req, res) => {
  const previousTenantId = req.user!.tenantId || null;
  const result = await authService.clearContext(req.user!.userId, req.user!.sessionId);
  await ControlAuditEvent.create({
    eventType: 'tenant.context.cleared',
    actorUserId: req.user!.userId,
    tenantId: previousTenantId,
    resourceType: 'tenant_context',
    resourceId: previousTenantId,
    outcome: 'success',
    details: {},
    requestId: req.requestId || null,
  });
  setRefreshCookie(res, result.refreshToken);
  res.json({ success: true, data: authResponse(result) });
}));

router.post('/invitations/:token/accept', authenticate, asyncHandler(async (req, res) => {
  const tenant = await Tenant.findByPk(String(req.body.tenantId || ''));
  if (!tenant) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '租户不存在' } });
    return;
  }
  const member = await runWithTenantContext(
    { schema: tenant.schemaName, tenantId: tenant.id },
    () => memberService.acceptInvitation(req.params.token, req.user!.userId),
  );
  res.json({ success: true, data: { memberId: member.id, tenantId: tenant.id } });
}));

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
    setRefreshCookie(res, result.refreshToken);
    res.json({ success: true, data: authResponse(result) });
  } catch (error: any) {
    res.clearCookie('refreshToken', { path: '/api/auth' });
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
      email: user.email,
      lastLogin: user.lastLogin,
      memberId: req.user!.memberId,
      tenantId: req.user!.tenantId,
      role: req.user!.role,
      roleIds: req.user!.roleIds,
      permissions: req.user!.permissions,
      permissionScopes: req.user!.permissionScopes,
      departmentIds: req.user!.departmentIds,
      primaryDepartmentId: req.user!.primaryDepartmentId,
      mustChangePassword: user.mustChangePassword,
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
    res.clearCookie('refreshToken', { path: '/api/auth' });

    await ControlAuditEvent.create({
      eventType: 'auth.password.changed',
      actorUserId: req.user!.userId,
      tenantId: req.user!.tenantId || null,
      resourceType: 'user',
      resourceId: req.user!.userId,
      outcome: 'success',
      details: { description: '用户修改密码' },
      requestId: req.requestId || null,
    });

    res.json({ success: true, message: '密码修改成功' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'CHANGE_PASSWORD_FAILED', message: error.message } });
  }
});

export default router;
