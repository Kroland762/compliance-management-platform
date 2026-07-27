import { Router, Request } from 'express';
import bcrypt from 'bcrypt';
import { authenticate, authorize } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import userService from '../services/user.service';
import { OperationType, Role, User } from '../models';
import auditLogService from '../services/audit-log.service';
import { validatePassword } from '../utils/password';
import { AppError, asyncHandler } from '../utils/http';
import {
  createUserBodySchema,
  listUsersQuerySchema,
  updateUserBodySchema,
  userIdParamsSchema,
} from '../validators/user.validators';

const router = Router();

router.use(authenticate);

/**
 * 获取当前请求的租户 scope
 * - 有 tenantId → 仅操作本租户用户
 * - 无 tenantId → 全局操作（超管）
 */
function getTenantScope(req: Request): string | null {
  return req.tenant?.id || null;
}

/**
 * 构建审计日志通用参数
 */
function auditCtx(req: Request, extra: Record<string, any> = {}) {
  const ipAddress = req.ip || req.socket.remoteAddress || undefined;
  const tenantId = getTenantScope(req) || (req.query.tenantId as string | undefined);

  return {
    userId: req.user!.userId,
    ipAddress,
    tenantId,
    ...extra,
  };
}

function toUserDto(user: User) {
  return {
    id: user.id,
    username: user.username,
    department: user.department,
    email: user.email,
    roleId: user.roleId,
    tenantId: user.tenantId,
    isActive: user.isActive,
  };
}

async function findRoleOrThrow(roleId: string) {
  const role = await Role.findByPk(roleId);
  if (!role) throw new AppError(400, 'INVALID_ROLE', '所选角色不存在');
  return role;
}

async function findUserOrThrow(id: string) {
  const user = await User.findByPk(id);
  if (!user) throw new AppError(404, 'NOT_FOUND', '用户不存在');
  return user;
}

function assertTenantCanOperateUser(req: Request, user: User): void {
  const tenantId = getTenantScope(req);
  if (tenantId && user.tenantId !== tenantId) {
    throw new AppError(404, 'NOT_FOUND', '用户不存在');
  }
}

// 创建用户
router.post(
  '/',
  authorize('users', 'create'),
  validate({ body: createUserBodySchema }),
  asyncHandler(async (req, res) => {
    const { username, password, department, email, roleId } = req.body;
    const tenantId = getTenantScope(req);

    if (tenantId) await findRoleOrThrow(roleId);

    const existing = await User.findOne({ where: { username } });
    if (existing) throw new AppError(400, 'DUPLICATE', '用户名已存在');

    const validation = validatePassword(password);
    if (!validation.valid) {
      throw new AppError(400, 'WEAK_PASSWORD', `密码不符合要求: ${validation.errors.join('；')}`);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      passwordHash,
      department: department || null,
      email: email || null,
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

    res.status(201).json({ success: true, data: toUserDto(user) });
  }),
);

// 用户列表 — 租户隔离
router.get(
  '/',
  authorize('users', 'read'),
  validate({ query: listUsersQuerySchema }),
  asyncHandler(async (req, res) => {
    const jwtTenantId = getTenantScope(req);
    // 租户管理员：强制只看自己租户
    // 超管：可通过 ?tenantId=xxx 查看特定租户，不传则看全部
    const effectiveTenantId = jwtTenantId || (req.query.tenantId as string) || undefined;
    const result = await userService.getUsers({ ...req.query as any, tenantId: effectiveTenantId });
    res.json({ success: true, data: result });
  }),
);

// 更新用户
router.put(
  '/:id',
  authorize('users', 'update'),
  validate({ params: userIdParamsSchema, body: updateUserBodySchema }),
  asyncHandler(async (req, res) => {
    const user = await findUserOrThrow(req.params.id);
    assertTenantCanOperateUser(req, user);

    const { department, email, roleId, isActive } = req.body;
    if (roleId !== undefined) {
      await findRoleOrThrow(roleId);
      user.roleId = roleId;
      // 角色变更 → 吊销所有旧 token
      user.tokenVersion = (user.tokenVersion || 1) + 1;
    }
    if (department !== undefined) user.department = department || null;
    if (email !== undefined) user.email = email || null;
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

    res.json({ success: true, data: toUserDto(user) });
  }),
);

// 禁用用户
router.delete(
  '/:id',
  authorize('users', 'delete'),
  validate({ params: userIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const user = await findUserOrThrow(req.params.id);
    assertTenantCanOperateUser(req, user);

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
  }),
);

export default router;
