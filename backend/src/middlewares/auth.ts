import { Request, Response, NextFunction } from 'express';
import authService from '../services/auth.service';
import type { PermissionMatrix, PermissionResource, PermissionAction } from '../models/Role';

// 扩展 Express Request 类型
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        username: string;
        role: string;       // 角色名
        roleId: string;     // 角色ID
        tenantId?: string;  // 租户ID
        permissions: PermissionMatrix;
      };
    }
  }
}

/**
 * JWT 认证中间件 - 验证请求是否携带有效令牌
 * 同时从 DB 加载用户角色和权限
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: '未提供认证令牌' } });
    return;
  }

  const token = authHeader.split(' ')[1];
  authService.verifyTokenAndLoadUser(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch((err) => {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: err.message || '令牌无效或已过期' } });
    });
}

/**
 * 权限中间件工厂 - 基于 RBAC 权限矩阵
 */
export function authorize(resource: PermissionResource, action: PermissionAction) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: '未认证' } });
      return;
    }

    // 超管（无 tenantId）直接放行，不检查 RBAC 矩阵
    if ((req as any)._isSuperAdmin || !(req.user as any).tenantId) {
      next();
      return;
    }

    const permissions = req.user.permissions;
    if (!permissions) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '无权限配置' } });
      return;
    }

    const allowed = permissions[resource];
    if (!allowed || !Array.isArray(allowed) || !allowed.includes(action)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: `缺少权限: ${resource}.${action}` } });
      return;
    }

    next();
  };
}

/**
 * 超管中间件 - 仅无 tenantId 的全局管理员可访问
 * 通过后设置 req._isSuperAdmin = true，使 authorize() 全部放行
 */
export function superAdminOnly(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: '未认证' } });
    return;
  }
  if ((req.user as any).tenantId) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '仅全局超管可操作' } });
    return;
  }
  (req as any)._isSuperAdmin = true;
  next();
}

/**
 * 多权限 OR 检查: authorizeAny([resource, action], [resource2, action2], ...)
 */
export function authorizeAny(...checks: Array<[PermissionResource, PermissionAction]>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: '未认证' } });
      return;
    }

    // 超管直接放行
    if ((req as any)._isSuperAdmin || !(req.user as any).tenantId) {
      next();
      return;
    }

    const permissions = req.user.permissions || {};
    const hasPermission = checks.some(([resource, action]) => {
      const allowed = permissions[resource];
      return allowed && Array.isArray(allowed) && allowed.includes(action);
    });

    if (!hasPermission) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '权限不足' } });
      return;
    }

    next();
  };
}
