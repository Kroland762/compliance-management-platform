import { Request, Response, NextFunction } from 'express';
import authService from '../services/auth.service';
import type {
  PermissionMatrix,
  PermissionScopeMatrix,
  PermissionResource,
  PermissionAction,
} from '../models/Role';
import { AppError } from '../utils/http';
import { enterResolvedTenant, resolveTenantForUser } from './tenant';

// 扩展 Express Request 类型
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        username: string;
        role: string;       // 角色名
        roleIds: string[];
        memberId?: string;
        tenantId?: string;  // 租户ID
        permissions: PermissionMatrix;
        permissionScopes: PermissionScopeMatrix;
        departmentIds: string[];
        primaryDepartmentId?: string;
        mustChangePassword: boolean;
        isGlobalAdmin: boolean;
        tokenKind: 'identity' | 'control' | 'tenant';
        sessionId: string;
      };
    }
  }
}

function hasPermission(permissions: PermissionMatrix | undefined, resource: PermissionResource, action: PermissionAction): boolean {
  const allowed = permissions?.[resource];
  return Array.isArray(allowed) && allowed.includes(action);
}

function isGlobalSuperAdmin(user: Express.Request['user']): boolean {
  if (!user?.isGlobalAdmin) return false;

  // 全局超管必须同时满足“无租户上下文”和“具备租户管理全权限”，避免仅凭 tenantId 缺失误放权。
  return ['create', 'read', 'update', 'delete'].every((action) => hasPermission(user.permissions, 'tenants', action));
}

/**
 * JWT 认证中间件 - 验证请求是否携带有效令牌
 * 同时从 DB 加载用户角色和权限
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  if (req.user) {
    next();
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(new AppError(401, 'UNAUTHORIZED', '未提供认证令牌'));
    return;
  }

  const token = authHeader.split(' ')[1];
  authService.verifyTokenAndLoadUser(token)
    .then(async (user) => {
      if (!user) throw new AppError(401, 'UNAUTHORIZED', '令牌对应的用户不存在');
      req.user = user;
      if (user.mustChangePassword) {
        const allowed = ['/api/auth/change-password', '/api/auth/logout'];
        if (!allowed.some((path) => req.originalUrl.split('?')[0] === path)) {
          throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', '首次登录必须先修改密码');
        }
      }
      const tenant = await resolveTenantForUser(req, user);
      enterResolvedTenant(req, tenant, next);
    })
    .catch((err) => {
      next(err instanceof AppError ? err : new AppError(401, 'UNAUTHORIZED', '令牌无效或已过期'));
    });
}

/**
 * 权限中间件工厂 - 基于 RBAC 权限矩阵
 */
export function authorize(resource: PermissionResource, action: PermissionAction) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, 'UNAUTHORIZED', '未认证'));
      return;
    }
    if (req.user.mustChangePassword) {
      next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', '首次登录必须先修改密码'));
      return;
    }

    // 仅 superAdminOnly 显式确认后的请求可跳过 RBAC；普通全局用户仍需检查权限矩阵。
    if ((req as any)._isSuperAdmin) {
      next();
      return;
    }

    if (!req.user.permissions) {
      next(new AppError(403, 'FORBIDDEN', '无权限配置'));
      return;
    }

    if (!hasPermission(req.user.permissions, resource, action)) {
      next(new AppError(403, 'FORBIDDEN', `缺少权限: ${resource}.${action}`));
      return;
    }

    next();
  };
}

/**
 * 超管中间件 - 仅无 tenantId 且具备租户管理全权限的全局管理员可访问
 * 通过后设置 req._isSuperAdmin = true，使后续 authorize() 全部放行
 */
export function superAdminOnly(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new AppError(401, 'UNAUTHORIZED', '未认证'));
    return;
  }
  if (!isGlobalSuperAdmin(req.user)) {
    next(new AppError(403, 'FORBIDDEN', '仅全局超管可操作'));
    return;
  }
  if (req.user.mustChangePassword) {
    next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', '首次登录必须先修改密码'));
    return;
  }
  (req as any)._isSuperAdmin = true;
  next();
}

/**
 * 多权限 OR 检查: authorizeAny([resource, action], [resource2, action2], ...)
 */
export function authorizeAny(...checks: Array<[PermissionResource, PermissionAction]>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, 'UNAUTHORIZED', '未认证'));
      return;
    }
    if (req.user.mustChangePassword) {
      next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', '首次登录必须先修改密码'));
      return;
    }

    // 仅 superAdminOnly 显式确认后的请求可跳过 RBAC。
    if ((req as any)._isSuperAdmin) {
      next();
      return;
    }

    const permissions = req.user.permissions || {};
    const hasAnyPermission = checks.some(([resource, action]) => hasPermission(permissions, resource, action));

    if (!hasAnyPermission) {
      next(new AppError(403, 'FORBIDDEN', '权限不足'));
      return;
    }

    next();
  };
}
