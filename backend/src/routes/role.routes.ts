import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import Role, { PERMISSION_DEFINITIONS } from '../models/Role';
import { User } from '../models';
import auditLogService from '../services/audit-log.service';
import { OperationType } from '../models';

const router = Router();
router.use(authenticate);

/**
 * GET /api/roles
 * 角色列表
 */
router.get('/', authorize('users', 'read'), async (_req: Request, res: Response) => {
  try {
    const roles = await Role.findAll({ order: [['createdAt', 'ASC']] });
    res.json({ success: true, data: roles });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * GET /api/roles/permission-defs
 * 权限定义清单（供前端渲染权限矩阵）
 */
router.get('/permission-defs', authorize('users', 'read'), async (_req: Request, res: Response) => {
  res.json({ success: true, data: PERMISSION_DEFINITIONS });
});

/**
 * GET /api/roles/:id
 * 角色详情
 */
router.get('/:id', authorize('users', 'read'), async (req: Request, res: Response) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '角色不存在' } }); return; }
    res.json({ success: true, data: role });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * POST /api/roles
 * 新建角色
 */
router.post('/', authorize('users', 'create'), async (req: Request, res: Response) => {
  try {
    const { name, description, permissions } = req.body;
    if (!name) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: '角色名称不能为空' } }); return; }

    const existing = await Role.findOne({ where: { name } });
    if (existing) { res.status(400).json({ success: false, error: { code: 'DUPLICATE', message: '角色名称已存在' } }); return; }

    const role = await Role.create({ name, description: description || null, permissions: permissions || {}, isSystem: false });

    await auditLogService.log({
      userId: req.user!.userId,
      operationType: OperationType.CREATE,
      resourceType: 'role',
      resourceId: role.id,
      operationDetails: `创建角色: ${name}`,
      success: true,
    });

    res.status(201).json({ success: true, data: role });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'CREATE_FAILED', message: error.message } });
  }
});

/**
 * PUT /api/roles/:id
 * 更新角色
 */
router.put('/:id', authorize('users', 'update'), async (req: Request, res: Response) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '角色不存在' } }); return; }

    const { name, description, permissions } = req.body;

    if (name !== undefined && name !== role.name) {
      const existing = await Role.findOne({ where: { name } });
      if (existing) { res.status(400).json({ success: false, error: { code: 'DUPLICATE', message: '角色名称已存在' } }); return; }
      role.name = name;
    }
    if (description !== undefined) role.description = description;
    if (permissions !== undefined) role.permissions = permissions;

    await role.save();

    await auditLogService.log({
      userId: req.user!.userId,
      operationType: OperationType.UPDATE,
      resourceType: 'role',
      resourceId: role.id,
      operationDetails: `更新角色: ${role.name}`,
      success: true,
    });

    res.json({ success: true, data: role });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

/**
 * DELETE /api/roles/:id
 * 删除角色（仅非系统角色，且角色下无用户）
 */
router.delete('/:id', authorize('users', 'delete'), async (req: Request, res: Response) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '角色不存在' } }); return; }

    if (role.isSystem) {
      res.status(400).json({ success: false, error: { code: 'SYSTEM_ROLE', message: '系统内置角色不可删除' } });
      return;
    }

    const userCount = await User.count({ where: { roleId: role.id } });
    if (userCount > 0) {
      res.status(400).json({ success: false, error: { code: 'ROLE_IN_USE', message: `该角色下还有 ${userCount} 个用户，请先转移用户` } });
      return;
    }

    await role.destroy();

    await auditLogService.log({
      userId: req.user!.userId,
      operationType: OperationType.DELETE,
      resourceType: 'role',
      resourceId: role.id,
      operationDetails: `删除角色: ${role.name}`,
      success: true,
    });

    res.json({ success: true, message: '角色已删除' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
});

export default router;
