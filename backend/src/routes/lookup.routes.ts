import { Router } from 'express';
import { Op } from 'sequelize';
import { authenticate, authorizeAny } from '../middlewares/auth';
import {
  Department,
  DepartmentMember,
  MemberRole,
  Role,
  TenantMember,
  TenantMemberStatus,
  User,
} from '../models';
import { asyncHandler } from '../utils/http';
import lookupService from '../services/lookup.service';

const router = Router();
router.use(authenticate);

router.get('/options/:kind', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await lookupService.list(req.params.kind, req.query, req.user!) });
}));

/**
 * Lightweight tenant-scoped lookups used by task and qualification forms.
 * The stable department id is always returned; legacy free-text departments
 * are deliberately not exposed.
 */
router.get('/departments', authorizeAny(
  ['organization', 'read'],
  ['tasks', 'create'],
  ['tasks', 'update'],
  ['findings', 'remediate'],
  ['findings', 'escalate'],
  ['qualifications', 'create'],
  ['qualifications', 'update'],
  ['products', 'create'],
  ['products', 'update'],
), asyncHandler(async (req, res) => {
  const keyword = String(req.query.q || '').trim();
  const departments = await Department.findAll({
    where: {
      status: 'active',
      ...(keyword ? { name: { [Op.iLike]: `%${keyword}%` } } : {}),
    },
    attributes: ['id', 'name', 'parentId'],
    order: [['sortOrder', 'ASC'], ['name', 'ASC']],
    limit: 100,
  });
  res.json({ success: true, data: departments });
}));

router.get('/personnel', authorizeAny(
  ['users', 'read'],
  ['tasks', 'update'],
  ['findings', 'remediate'],
  ['findings', 'escalate'],
  ['qualifications', 'create'],
  ['qualifications', 'update'],
  ['products', 'create'],
  ['products', 'update'],
), asyncHandler(async (req, res) => {
  const keyword = String(req.query.q || '').trim();
  const departmentId = String(req.query.departmentId || '');
  let allowedMemberIds: string[] | null = null;
  if (departmentId) {
    const links = await DepartmentMember.findAll({
      where: { departmentId },
      attributes: ['memberId'],
    });
    allowedMemberIds = links.map((link) => link.memberId);
    if (allowedMemberIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }
  }

  const members = await TenantMember.findAll({
    where: {
      status: TenantMemberStatus.ACTIVE,
      ...(allowedMemberIds ? { id: { [Op.in]: allowedMemberIds } } : {}),
      ...(keyword ? { displayName: { [Op.iLike]: `%${keyword}%` } } : {}),
    },
    order: [['displayName', 'ASC']],
    limit: 100,
  });
  const userIds = members.map((member) => member.userId);
  const [users, links, departments] = await Promise.all([
    userIds.length
      ? User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ['id', 'username', 'email'] })
      : [],
    members.length
      ? DepartmentMember.findAll({ where: { memberId: { [Op.in]: members.map((member) => member.id) } } })
      : [],
    Department.findAll({ where: { status: 'active' }, attributes: ['id', 'name'] }),
  ]);
  const userMap = new Map(users.map((user) => [user.id, user]));
  const departmentMap = new Map(departments.map((department) => [department.id, department]));
  res.json({
    success: true,
    data: members.map((member) => {
      const user = userMap.get(member.userId);
      const memberships = links.filter((link) => link.memberId === member.id);
      const primary = memberships.find((link) => link.isPrimary);
      return {
        memberId: member.id,
        userId: member.userId,
        username: user?.username,
        displayName: member.displayName,
        email: member.email || user?.email || null,
        primaryDepartmentId: primary?.departmentId || null,
        primaryDepartmentName: primary ? departmentMap.get(primary.departmentId)?.name || null : null,
        departments: memberships.map((link) => ({
          id: link.departmentId,
          name: departmentMap.get(link.departmentId)?.name || null,
          isPrimary: link.isPrimary,
        })),
      };
    }),
  });
}));

router.get('/auditors', authorizeAny(['tasks', 'create'], ['tasks', 'update']), asyncHandler(async (_req, res) => {
  const reviewRoles = await Role.findAll({ attributes: ['id', 'permissions'] });
  const roleIds = reviewRoles
    .filter((role) => role.permissions?.evaluations?.includes('review'))
    .map((role) => role.id);
  if (!roleIds.length) {
    res.json({ success: true, data: [] });
    return;
  }
  const memberRoles = await MemberRole.findAll({ where: { roleId: { [Op.in]: roleIds } }, attributes: ['memberId'] });
  const memberIds = [...new Set(memberRoles.map((item) => item.memberId))];
  const members = await TenantMember.findAll({
    where: { id: { [Op.in]: memberIds }, status: TenantMemberStatus.ACTIVE },
    order: [['displayName', 'ASC']],
  });
  const users = members.length
    ? await User.findAll({ where: { id: { [Op.in]: members.map((member) => member.userId) } }, attributes: ['id', 'username', 'email'] })
    : [];
  const userMap = new Map(users.map((user) => [user.id, user]));
  res.json({
    success: true,
    data: members.map((member) => ({
      memberId: member.id,
      userId: member.userId,
      username: userMap.get(member.userId)?.username,
      displayName: member.displayName,
      email: member.email || userMap.get(member.userId)?.email || null,
    })),
  });
}));

export default router;
