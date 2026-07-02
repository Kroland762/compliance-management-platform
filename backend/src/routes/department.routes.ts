import { Router, Request } from 'express';
import { Op } from 'sequelize';
import { authenticate, authorize } from '../middlewares/auth';
import { Department, DepartmentMember, OperationType, User } from '../models';
import auditLogService from '../services/audit-log.service';
import { AppError, asyncHandler } from '../utils/http';

const router = Router();
router.use(authenticate);

type DepartmentDto = {
  id: string;
  name: string;
  parentId: string | null;
  description: string | null;
  sortOrder: number;
  memberCount: number;
  children: DepartmentDto[];
};

function auditCtx(req: Request, extra: Record<string, any> = {}) {
  return {
    userId: req.user!.userId,
    ipAddress: req.ip || req.socket.remoteAddress || undefined,
    tenantId: (req.user as any)?.tenantId || undefined,
    ...extra,
  };
}

async function getDepartmentOrThrow(id: string) {
  const department = await Department.findByPk(id);
  if (!department) throw new AppError(404, 'NOT_FOUND', '部门不存在');
  return department;
}

async function assertParentIsValid(id: string | undefined, parentId: string | null | undefined) {
  if (parentId === undefined || parentId === null || parentId === '') return;
  if (id && id === parentId) throw new AppError(400, 'INVALID_PARENT', '上级部门不能是自身');
  const parent = await Department.findByPk(parentId);
  if (!parent) throw new AppError(400, 'INVALID_PARENT', '上级部门不存在');

  let currentParentId = parent.parentId;
  while (currentParentId) {
    if (currentParentId === id) {
      throw new AppError(400, 'INVALID_PARENT', '不能将部门移动到自己的子部门下');
    }
    const next = await Department.findByPk(currentParentId);
    currentParentId = next?.parentId || null;
  }
}

async function assertNoNameConflict(name: string, parentId: string | null, excludeId?: string) {
  const existing = await Department.findOne({
    where: {
      name,
      parentId: parentId || null,
      ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
    },
  });
  if (existing) throw new AppError(400, 'DUPLICATE', '同级部门名称已存在');
}

function buildDepartmentTree(departments: Department[], memberCountByDept: Map<string, number>): DepartmentDto[] {
  const nodes = new Map<string, DepartmentDto>();
  departments.forEach((department) => {
    nodes.set(department.id, {
      id: department.id,
      name: department.name,
      parentId: department.parentId,
      description: department.description,
      sortOrder: department.sortOrder,
      memberCount: memberCountByDept.get(department.id) || 0,
      children: [],
    });
  });

  const roots: DepartmentDto[] = [];
  nodes.forEach((node) => {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortTree = (items: DepartmentDto[]) => {
    items.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-Hans-CN'));
    items.forEach((item) => sortTree(item.children));
  };
  sortTree(roots);
  return roots;
}

router.get(
  '/',
  authorize('organization', 'read'),
  asyncHandler(async (_req, res) => {
    const [departments, counts] = await Promise.all([
      Department.findAll({ order: [['sortOrder', 'ASC'], ['name', 'ASC']] }),
      DepartmentMember.findAll({ attributes: ['departmentId', 'userId'] }),
    ]);
    const memberCountByDept = new Map<string, number>();
    counts.forEach((member) => {
      memberCountByDept.set(member.departmentId, (memberCountByDept.get(member.departmentId) || 0) + 1);
    });
    res.json({ success: true, data: buildDepartmentTree(departments, memberCountByDept) });
  }),
);

router.post(
  '/',
  authorize('organization', 'create'),
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const parentId = req.body.parentId || null;
    const description = req.body.description ? String(req.body.description).trim() : null;
    const sortOrder = Number.isFinite(Number(req.body.sortOrder)) ? Number(req.body.sortOrder) : 0;

    if (!name) throw new AppError(400, 'VALIDATION_ERROR', '部门名称不能为空');
    await assertParentIsValid(undefined, parentId);
    await assertNoNameConflict(name, parentId);

    const department = await Department.create({ name, parentId, description, sortOrder });
    await auditLogService.log({
      ...auditCtx(req),
      operationType: OperationType.CREATE,
      resourceType: 'department',
      resourceId: department.id,
      operationDetails: `创建部门: ${department.name}`,
      success: true,
    });
    res.status(201).json({ success: true, data: department });
  }),
);

router.put(
  '/:id',
  authorize('organization', 'update'),
  asyncHandler(async (req, res) => {
    const department = await getDepartmentOrThrow(req.params.id);
    const nextName = req.body.name !== undefined ? String(req.body.name).trim() : department.name;
    const nextParentId = req.body.parentId !== undefined ? (req.body.parentId || null) : department.parentId;
    const nextDescription = req.body.description !== undefined ? (req.body.description ? String(req.body.description).trim() : null) : department.description;
    const nextSortOrder = req.body.sortOrder !== undefined && Number.isFinite(Number(req.body.sortOrder)) ? Number(req.body.sortOrder) : department.sortOrder;

    if (!nextName) throw new AppError(400, 'VALIDATION_ERROR', '部门名称不能为空');
    await assertParentIsValid(department.id, nextParentId);
    await assertNoNameConflict(nextName, nextParentId, department.id);

    await department.update({ name: nextName, parentId: nextParentId, description: nextDescription, sortOrder: nextSortOrder });
    await auditLogService.log({
      ...auditCtx(req),
      operationType: OperationType.UPDATE,
      resourceType: 'department',
      resourceId: department.id,
      operationDetails: `更新部门: ${department.name}`,
      success: true,
    });
    res.json({ success: true, data: department });
  }),
);

router.delete(
  '/:id',
  authorize('organization', 'delete'),
  asyncHandler(async (req, res) => {
    const department = await getDepartmentOrThrow(req.params.id);
    const [childCount, memberCount] = await Promise.all([
      Department.count({ where: { parentId: department.id } }),
      DepartmentMember.count({ where: { departmentId: department.id } }),
    ]);
    if (childCount > 0) throw new AppError(400, 'HAS_CHILDREN', '请先删除或移动子部门');
    if (memberCount > 0) throw new AppError(400, 'HAS_MEMBERS', '请先移除部门成员');

    await department.destroy();
    await auditLogService.log({
      ...auditCtx(req),
      operationType: OperationType.DELETE,
      resourceType: 'department',
      resourceId: department.id,
      operationDetails: `删除部门: ${department.name}`,
      success: true,
    });
    res.json({ success: true, message: '部门已删除' });
  }),
);

router.get(
  '/:id/members',
  authorize('organization', 'read'),
  asyncHandler(async (req, res) => {
    await getDepartmentOrThrow(req.params.id);
    const members = await DepartmentMember.findAll({
      where: { departmentId: req.params.id },
      include: [{ model: User, as: 'user', attributes: ['id', 'username', 'email', 'department', 'roleId', 'isActive'] }],
      order: [[{ model: User, as: 'user' }, 'username', 'ASC']],
    });
    res.json({ success: true, data: members.map((member) => (member as any).user).filter(Boolean) });
  }),
);

router.put(
  '/:id/members',
  authorize('organization', 'update'),
  asyncHandler(async (req, res) => {
    const department = await getDepartmentOrThrow(req.params.id);
    const userIds = Array.isArray(req.body.userIds) ? Array.from(new Set(req.body.userIds.filter(Boolean))) as string[] : [];
    const users = await User.findAll({ where: { id: userIds, isActive: true } });
    if (users.length !== userIds.length) throw new AppError(400, 'INVALID_USERS', '成员列表包含不存在或已禁用的用户');

    await DepartmentMember.destroy({ where: { departmentId: department.id } });
    if (userIds.length > 0) {
      await DepartmentMember.bulkCreate(userIds.map((userId) => ({ departmentId: department.id, userId })));
    }
    await auditLogService.log({
      ...auditCtx(req),
      operationType: OperationType.UPDATE,
      resourceType: 'department',
      resourceId: department.id,
      operationDetails: `更新部门成员: ${department.name}, 成员数: ${userIds.length}`,
      success: true,
    });
    res.json({ success: true, data: { departmentId: department.id, userIds } });
  }),
);

export default router;
