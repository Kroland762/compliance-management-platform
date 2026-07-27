import { Router } from 'express';
import { Op } from 'sequelize';
import sequelize from '../config/database';
import { authenticate, authorize } from '../middlewares/auth';
import {
  Department,
  DepartmentMember,
  OperationType,
  TenantMember,
  TenantMemberStatus,
} from '../models';
import auditLogService from '../services/audit-log.service';
import memberService from '../services/member.service';
import { AppError, asyncHandler } from '../utils/http';

const router = Router();
router.use(authenticate);

type DepartmentDto = {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  description: string | null;
  sortOrder: number;
  managerMemberId: string | null;
  status: 'active' | 'archived';
  memberCount: number;
  children: DepartmentDto[];
};

async function departmentOrNotFound(id: string) {
  const department = await Department.findByPk(id);
  if (!department) throw new AppError(404, 'NOT_FOUND', '部门不存在');
  return department;
}

async function validateManager(memberId?: string | null): Promise<void> {
  if (!memberId) return;
  const member = await TenantMember.findOne({ where: { id: memberId, status: TenantMemberStatus.ACTIVE } });
  if (!member) throw new AppError(404, 'NOT_FOUND', '部门负责人不存在');
}

async function validateParent(id: string | undefined, parentId: string | null): Promise<void> {
  if (!parentId) return;
  if (id === parentId) throw new AppError(400, 'INVALID_PARENT', '上级部门不能是自身');
  let current: string | null = parentId;
  let depth = 1;
  while (current) {
    const parent: Department | null = await Department.findByPk(current);
    if (!parent || parent.status !== 'active') throw new AppError(404, 'NOT_FOUND', '上级部门不存在');
    if (parent.parentId === id) throw new AppError(400, 'INVALID_PARENT', '不能形成循环部门层级');
    current = parent.parentId;
    depth += 1;
    if (depth > 10) throw new AppError(400, 'DEPARTMENT_DEPTH_EXCEEDED', '部门层级不能超过十级');
  }
}

async function ensureUnique(name: string, code: string, parentId: string | null, excludeId?: string) {
  const whereId = excludeId ? { id: { [Op.ne]: excludeId } } : {};
  if (await Department.findOne({ where: { name, parentId, ...whereId } })) {
    throw new AppError(409, 'CONFLICT', '同级部门名称已存在');
  }
  if (await Department.findOne({ where: { code, ...whereId } })) {
    throw new AppError(409, 'CONFLICT', '部门编码已存在');
  }
}

function buildTree(departments: Department[], counts: Map<string, number>): DepartmentDto[] {
  const nodes = new Map<string, DepartmentDto>();
  for (const department of departments) {
    nodes.set(department.id, {
      id: department.id,
      name: department.name,
      code: department.code,
      parentId: department.parentId,
      description: department.description,
      sortOrder: department.sortOrder,
      managerMemberId: department.managerMemberId,
      status: department.status,
      memberCount: counts.get(department.id) || 0,
      children: [],
    });
  }
  const roots: DepartmentDto[] = [];
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) nodes.get(node.parentId)!.children.push(node);
    else roots.push(node);
  }
  const sort = (items: DepartmentDto[]) => {
    items.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-Hans-CN'));
    items.forEach((item) => sort(item.children));
  };
  sort(roots);
  return roots;
}

router.get('/', authorize('organization', 'read'), asyncHandler(async (req, res) => {
  const includeArchived = req.query.includeArchived === 'true';
  const [departments, memberships] = await Promise.all([
    Department.findAll({
      where: includeArchived ? {} : { status: 'active' },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']],
    }),
    DepartmentMember.findAll({ attributes: ['departmentId', 'memberId'] }),
  ]);
  const counts = new Map<string, number>();
  memberships.forEach((membership) => counts.set(
    membership.departmentId,
    (counts.get(membership.departmentId) || 0) + 1,
  ));
  res.json({ success: true, data: buildTree(departments, counts) });
}));

router.post('/', authorize('organization', 'create'), asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const code = String(req.body.code || '').trim().toUpperCase();
  const parentId = req.body.parentId || null;
  if (!name || !/^[A-Z0-9_-]{2,60}$/.test(code)) {
    throw new AppError(400, 'VALIDATION_ERROR', '部门名称必填，编码需为 2-60 位大写字母、数字、下划线或横线');
  }
  await validateParent(undefined, parentId);
  await validateManager(req.body.managerMemberId);
  await ensureUnique(name, code, parentId);
  const department = await Department.create({
    name,
    code,
    parentId,
    description: req.body.description || null,
    sortOrder: Number(req.body.sortOrder || 0),
    managerMemberId: req.body.managerMemberId || null,
    status: 'active',
  });
  await auditLogService.log({
    userId: req.user!.userId,
    operationType: OperationType.CREATE,
    resourceType: 'department',
    resourceId: department.id,
    operationDetails: `创建部门: ${department.name} (${department.code})`,
    success: true,
    tenantId: req.tenant!.id,
    departmentId: req.user!.primaryDepartmentId,
    ipAddress: req.ip,
  });
  res.status(201).json({ success: true, data: department });
}));

router.put('/:id', authorize('organization', 'update'), asyncHandler(async (req, res) => {
  const department = await departmentOrNotFound(req.params.id);
  if (department.status === 'archived') throw new AppError(409, 'DEPARTMENT_ARCHIVED', '归档部门不可编辑');
  const name = req.body.name !== undefined ? String(req.body.name).trim() : department.name;
  const parentId = req.body.parentId !== undefined ? req.body.parentId || null : department.parentId;
  if (req.body.code !== undefined && String(req.body.code).toUpperCase() !== department.code) {
    throw new AppError(409, 'DEPARTMENT_CODE_IMMUTABLE', '部门编码创建后不可修改');
  }
  await validateParent(department.id, parentId);
  await validateManager(req.body.managerMemberId);
  await ensureUnique(name, department.code, parentId, department.id);
  await department.update({
    name,
    parentId,
    description: req.body.description !== undefined ? req.body.description || null : department.description,
    sortOrder: req.body.sortOrder !== undefined ? Number(req.body.sortOrder) : department.sortOrder,
    managerMemberId: req.body.managerMemberId !== undefined
      ? req.body.managerMemberId || null
      : department.managerMemberId,
  });
  res.json({ success: true, data: department });
}));

router.delete('/:id', authorize('organization', 'delete'), asyncHandler(async (req, res) => {
  const department = await departmentOrNotFound(req.params.id);
  if (department.code === 'ROOT') throw new AppError(409, 'ROOT_DEPARTMENT_REQUIRED', '根部门不可归档');
  const children = await Department.count({ where: { parentId: department.id, status: 'active' } });
  if (children > 0) throw new AppError(409, 'HAS_CHILDREN', '请先移动或归档子部门');
  const members = await DepartmentMember.count({ where: { departmentId: department.id } });
  if (members > 0) throw new AppError(409, 'HAS_MEMBERS', '请先转移部门成员');
  await department.update({ status: 'archived', archivedAt: new Date() });
  res.json({ success: true, message: '部门已归档' });
}));

router.get('/:id/members', authorize('organization', 'read'), asyncHandler(async (req, res) => {
  await departmentOrNotFound(req.params.id);
  const links = await DepartmentMember.findAll({ where: { departmentId: req.params.id } });
  const members = await Promise.all(links.map(async (link) => {
    const member = await TenantMember.findByPk(link.memberId);
    if (!member) return null;
    return {
      ...(await memberService.toDto(member)),
      isPrimary: link.isPrimary,
      positionTitle: link.positionTitle,
    };
  }));
  res.json({ success: true, data: members.filter(Boolean) });
}));

router.put('/:id/members', authorize('organization', 'update'), asyncHandler(async (req, res) => {
  const department = await departmentOrNotFound(req.params.id);
  if (department.status !== 'active') throw new AppError(409, 'DEPARTMENT_ARCHIVED', '归档部门不可调整成员');
  const assignments = Array.isArray(req.body.members) ? req.body.members : [];
  await sequelize.transaction(async (transaction) => {
    const existing = await DepartmentMember.findAll({
      where: { departmentId: department.id },
      attributes: ['memberId'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const memberIds = Array.from(new Set(assignments.map((item: any) => item.memberId).filter(Boolean))) as string[];
    const affectedMemberIds = Array.from(new Set([
      ...memberIds,
      ...existing.map((item) => item.memberId),
    ]));
    const members = await TenantMember.findAll({
      where: { id: { [Op.in]: memberIds }, status: TenantMemberStatus.ACTIVE },
      transaction,
    });
    if (members.length !== memberIds.length) throw new AppError(404, 'NOT_FOUND', '成员不存在或不属于当前租户');
    for (const assignment of assignments) {
      if (assignment.isPrimary) {
        await DepartmentMember.update(
          { isPrimary: false },
          { where: { memberId: assignment.memberId }, transaction },
        );
      }
    }
    await DepartmentMember.destroy({ where: { departmentId: department.id }, transaction });
    if (assignments.length > 0) {
      await DepartmentMember.bulkCreate(assignments.map((assignment: any) => ({
        departmentId: department.id,
        memberId: assignment.memberId,
        isPrimary: Boolean(assignment.isPrimary),
        positionTitle: assignment.positionTitle || null,
      })), { transaction });
    }
    for (const memberId of affectedMemberIds) {
      const member = await TenantMember.findByPk(memberId, { transaction });
      if (!member || member.status !== TenantMemberStatus.ACTIVE) continue;
      const primaryCount = await DepartmentMember.count({
        where: { memberId, isPrimary: true },
        transaction,
      });
      if (primaryCount !== 1) {
        throw new AppError(400, 'PRIMARY_DEPARTMENT_REQUIRED', '每个 active 成员必须且只能有一个主部门');
      }
    }
  });
  res.json({ success: true, message: '部门成员已更新' });
}));

export default router;
