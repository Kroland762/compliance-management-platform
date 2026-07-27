import { Router } from 'express';
import { Op } from 'sequelize';
import { authenticate, authorize } from '../middlewares/auth';
import Role, { PERMISSION_DEFINITIONS } from '../models/Role';
import { MemberRole, OperationType } from '../models';
import auditLogService from '../services/audit-log.service';
import { AppError, asyncHandler } from '../utils/http';
import { pagination, parsePagination } from '../utils/pagination';

const router = Router();
router.use(authenticate);

const DATA_SCOPES = ['self', 'assigned', 'department', 'department_tree', 'all'];

function validatePermissionConfiguration(
  permissions: Record<string, string[]> = {},
  permissionScopes: Record<string, Record<string, string>> = {},
): void {
  for (const [resource, actions] of Object.entries(permissions)) {
    const definitions = PERMISSION_DEFINITIONS[resource as keyof typeof PERMISSION_DEFINITIONS] as readonly string[] | undefined;
    if (!definitions || !Array.isArray(actions) || actions.some((action) => !definitions.includes(action))) {
      throw new AppError(400, 'VALIDATION_ERROR', `非法权限配置: ${resource}`);
    }
    for (const action of actions) {
      const scope = permissionScopes?.[resource]?.[action];
      if (!scope || !DATA_SCOPES.includes(scope)) {
        throw new AppError(400, 'VALIDATION_ERROR', `权限 ${resource}.${action} 必须配置有效数据范围`);
      }
    }
  }
  for (const [resource, scopes] of Object.entries(permissionScopes)) {
    for (const action of Object.keys(scopes || {})) {
      if (!permissions[resource]?.includes(action)) {
        throw new AppError(400, 'VALIDATION_ERROR', `数据范围没有对应权限: ${resource}.${action}`);
      }
    }
  }
}

async function roleOrNotFound(id: string, tenantId: string) {
  const role = await Role.findOne({ where: { id, tenantId } });
  if (!role) throw new AppError(404, 'NOT_FOUND', '角色不存在');
  return role;
}

router.get('/', authorize('users', 'read'), asyncHandler(async (req, res) => {
  const { page, pageSize } = parsePagination(req.query);
  const { count, rows } = await Role.findAndCountAll({
    where: { tenantId: req.tenant!.id },
    order: [['isSystem', 'DESC'], ['createdAt', 'ASC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  res.json({ success: true, data: { items: rows, pagination: pagination(page, pageSize, count) } });
}));

router.get('/permission-defs', authorize('users', 'read'), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { resources: PERMISSION_DEFINITIONS, dataScopes: DATA_SCOPES } });
}));

router.post('/', authorize('users', 'create'), asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new AppError(400, 'VALIDATION_ERROR', '角色名称不能为空');
  if (await Role.findOne({ where: { tenantId: req.tenant!.id, name } })) {
    throw new AppError(409, 'CONFLICT', '角色名称已存在');
  }
  validatePermissionConfiguration(req.body.permissions || {}, req.body.permissionScopes || {});
  const role = await Role.create({
    tenantId: req.tenant!.id,
    name,
    description: req.body.description || null,
    permissions: req.body.permissions || {},
    permissionScopes: req.body.permissionScopes || {},
    isSystem: false,
    systemKey: null,
    isLocked: false,
  });
  await auditLogService.log({
    userId: req.user!.userId,
    operationType: OperationType.CREATE,
    resourceType: 'role',
    resourceId: role.id,
    operationDetails: `创建角色: ${role.name}`,
    success: true,
    tenantId: req.tenant!.id,
    departmentId: req.user!.primaryDepartmentId,
    ipAddress: req.ip,
  });
  res.status(201).json({ success: true, data: role });
}));

router.post('/:id/clone', authorize('users', 'create'), asyncHandler(async (req, res) => {
  const source = await roleOrNotFound(req.params.id, req.tenant!.id);
  const name = String(req.body.name || `${source.name} 副本`).trim();
  if (await Role.findOne({ where: { tenantId: req.tenant!.id, name } })) {
    throw new AppError(409, 'CONFLICT', '角色名称已存在');
  }
  const role = await Role.create({
    tenantId: req.tenant!.id,
    name,
    description: req.body.description ?? source.description,
    permissions: source.permissions,
    permissionScopes: source.permissionScopes,
    isSystem: false,
    systemKey: null,
    isLocked: false,
  });
  res.status(201).json({ success: true, data: role });
}));

router.get('/:id', authorize('users', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await roleOrNotFound(req.params.id, req.tenant!.id) });
}));

router.put('/:id', authorize('users', 'update'), asyncHandler(async (req, res) => {
  const role = await roleOrNotFound(req.params.id, req.tenant!.id);
  if (role.isSystem || role.isLocked) {
    throw new AppError(409, 'SYSTEM_ROLE_LOCKED', '系统角色不可修改，请复制后编辑');
  }
  const nextName = req.body.name !== undefined ? String(req.body.name).trim() : role.name;
  if (!nextName) throw new AppError(400, 'VALIDATION_ERROR', '角色名称不能为空');
  if (nextName !== role.name && await Role.findOne({ where: { tenantId: req.tenant!.id, name: nextName } })) {
    throw new AppError(409, 'CONFLICT', '角色名称已存在');
  }
  const nextPermissions = req.body.permissions !== undefined ? req.body.permissions : role.permissions;
  const nextScopes = req.body.permissionScopes !== undefined ? req.body.permissionScopes : role.permissionScopes;
  validatePermissionConfiguration(nextPermissions, nextScopes);
  await role.update({
    name: nextName,
    ...(req.body.description !== undefined ? { description: req.body.description || null } : {}),
    permissions: nextPermissions,
    permissionScopes: nextScopes,
  });
  const assignments = await MemberRole.findAll({ where: { roleId: role.id } });
  if (assignments.length > 0) {
    const { TenantMember } = await import('../models');
    await TenantMember.increment('sessionVersion', {
      by: 1,
      where: { id: { [Op.in]: assignments.map((assignment) => assignment.memberId) } },
    });
  }
  await auditLogService.log({
    userId: req.user!.userId,
    operationType: OperationType.UPDATE,
    resourceType: 'role',
    resourceId: role.id,
    operationDetails: `更新角色: ${role.name}`,
    success: true,
    tenantId: req.tenant!.id,
    departmentId: req.user!.primaryDepartmentId,
    ipAddress: req.ip,
  });
  res.json({ success: true, data: role });
}));

router.delete('/:id', authorize('users', 'delete'), asyncHandler(async (req, res) => {
  const role = await roleOrNotFound(req.params.id, req.tenant!.id);
  if (role.isSystem || role.isLocked) throw new AppError(409, 'SYSTEM_ROLE', '系统角色不可删除');
  const count = await MemberRole.count({ where: { roleId: role.id } });
  if (count > 0) throw new AppError(409, 'ROLE_IN_USE', `该角色下还有 ${count} 个成员`);
  await role.destroy();
  await auditLogService.log({
    userId: req.user!.userId,
    operationType: OperationType.DELETE,
    resourceType: 'role',
    resourceId: role.id,
    operationDetails: `删除角色: ${role.name}`,
    success: true,
    tenantId: req.tenant!.id,
    departmentId: req.user!.primaryDepartmentId,
    ipAddress: req.ip,
  });
  res.json({ success: true, message: '角色已删除' });
}));

export default router;
