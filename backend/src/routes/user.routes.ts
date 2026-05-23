import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import userService from '../services/user.service';
import { User, Role } from '../models';
import bcrypt from 'bcrypt';
import auditLogService from '../services/audit-log.service';
import { OperationType } from '../models';
import { validatePassword } from '../utils/password';

const router = Router();

router.use(authenticate);

/**
 * 获取当前请求的租户 scope
 * - 有 tenantId → 仅操作本租户用户
 * - 无 tenantId → 全局操作（超管）
 */
function getTenantScope(req: Request): string | null {
  return (req.user as any)?.tenantId || null;
}

/**
 * 构建审计日志通用参数
 */
function auditCtx(req: Request, extra: Record<string, any> = {}) {
  return {
    userId: req.user!.userId,
    ipAddress: req.ip || req.socket.remoteAddress || null,
    tenantId: getTenantScope(req) || (req.query.tenantId as string) || null,
    ...extra,
  };
}

// 创建用户
router.post('/', authorize('users', 'create'), async (req: Request, res: Response) => {
  try {
    const { username, password, department, roleId } = req.body;
    if (!username || !password || !roleId) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: '用户名、密码和角色为必填项' } });
      return;
    }

    const tenantId = getTenantScope(req);

    // 租户管理员只能创建本租户用户
    if (tenantId) {
      // 验证角色属于本租户
      const role = await Role.findOne({ where: { id: roleId } });
      if (!role) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ROLE', message: '所选角色不存在' } });
        return;
      }
    }

    const existing = await User.findOne({ where: { username } });
    if (existing) {
      res.status(400).json({ success: false, error: { code: 'DUPLICATE', message: '用户名已存在' } });
      return;
    }

    const validation = validatePassword(password);
    if (!validation.valid) {
      res.status(400).json({ success: false, error: { code: 'WEAK_PASSWORD', message: `密码不符合要求: ${validation.errors.join('；')}` } });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      passwordHash,
      department: department || null,
      role: 'user' as any,
      roleId,
      tenantId: tenantId || null,
      isActive: true,
    } as any);

    await auditLogService.log({
      ...auditCtx(req),
      operationType: OperationType.CREATE,
      resourceType: 'user',
      resourceId: user.id,
      operationDetails: `创建用户: ${username}, 租户: ${tenantId || '全局'}`,
      success: true,
    });

    res.status(201).json({ success: true, data: { id: user.id, username: user.username, department: user.department, tenantId: user.tenantId } });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'CREATE_FAILED', message: error.message } });
  }
});

// 用户列表 — 租户隔离
router.get('/', authorize('users', 'read'), async (req: Request, res: Response) => {
  try {
    const jwtTenantId = getTenantScope(req);
    // 租户管理员：强制只看自己租户
    // 超管：可通过 ?tenantId=xxx 查看特定租户，不传则看全部
    const effectiveTenantId = jwtTenantId || (req.query.tenantId as string) || undefined;
    const result = await userService.getUsers({ ...req.query as any, tenantId: effectiveTenantId });
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

// 更新用户
router.put('/:id', authorize('users', 'update'), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantScope(req);
    const user = await User.findByPk(req.params.id);
    if (!user) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '用户不存在' } });
      return;
    }

    // 超管（tenantId=null）直接放行；租户管理员只能操作本租户用户
    if (tenantId && user.tenantId !== tenantId) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '不能操作其他租户的用户' } });
      return;
    }

    const { department, email, roleId, isActive } = req.body;
    if (roleId !== undefined) {
      const role = await Role.findByPk(roleId);
      if (!role) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ROLE', message: '所选角色不存在' } });
        return;
      }
      user.roleId = roleId;
      // 角色变更 → 吊销所有旧 token
      user.tokenVersion = (user.tokenVersion || 1) + 1;
    }
    if (department !== undefined) user.department = department;
    if (email !== undefined) user.email = email;
    if (isActive !== undefined) user.isActive = isActive;

    await user.save();

    await auditLogService.log({
      ...auditCtx(req),
      operationType: OperationType.UPDATE,
      resourceType: 'user',
      resourceId: user.id,
      operationDetails: `更新用户: ${user.username}`,
      success: true,
    });

    res.json({ success: true, data: { id: user.id, username: user.username, department: user.department, tenantId: user.tenantId } });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

// 禁用用户
router.delete('/:id', authorize('users', 'delete'), async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantScope(req);
    const user = await User.findByPk(req.params.id);
    if (!user) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '用户不存在' } });
      return;
    }

    // 超管（tenantId=null）直接放行；租户管理员只能操作本租户用户
    if (tenantId && user.tenantId !== tenantId) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '不能操作其他租户的用户' } });
      return;
    }

    user.isActive = false;
    // 禁用用户 → 吊销所有旧 token
    user.tokenVersion = (user.tokenVersion || 1) + 1;
    await user.save();

    await auditLogService.log({
      ...auditCtx(req),
      operationType: OperationType.DELETE,
      resourceType: 'user',
      resourceId: user.id,
      operationDetails: `禁用用户: ${user.username}`,
      success: true,
    });

    res.json({ success: true, message: '用户已禁用' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
});

export default router;
