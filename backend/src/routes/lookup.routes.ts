import { Router } from 'express';
import { Op } from 'sequelize';
import { authenticate, authorizeAny } from '../middlewares/auth';
import {
  Department,
  DepartmentMember,
  TenantMember,
  TenantMemberStatus,
  User,
} from '../models';
import { asyncHandler } from '../utils/http';

const router = Router();
router.use(authenticate);

/**
 * Lightweight tenant-scoped lookups used by task and qualification forms.
 * The stable department id is always returned; legacy free-text departments
 * are deliberately not exposed.
 */
router.get('/departments', authorizeAny(
  ['organization', 'read'],
  ['tasks', 'create'],
  ['tasks', 'update'],
  ['qualifications', 'create'],
  ['qualifications', 'update'],
), asyncHandler(async (req, res) => {
  const keyword = String(req.query.q || '').trim();
  const departments = await Department.findAll({
    where: {
      status: 'active',
      ...(keyword ? {
        [Op.or]: [
          { name: { [Op.iLike]: `%${keyword}%` } },
          { code: { [Op.iLike]: `%${keyword}%` } },
        ],
      } : {}),
    },
    attributes: ['id', 'name', 'code', 'parentId'],
    order: [['sortOrder', 'ASC'], ['name', 'ASC']],
    limit: 100,
  });
  res.json({ success: true, data: departments });
}));

router.get('/personnel', authorizeAny(
  ['users', 'read'],
  ['tasks', 'update'],
  ['qualifications', 'create'],
  ['qualifications', 'update'],
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
    Department.findAll({ where: { status: 'active' }, attributes: ['id', 'name', 'code'] }),
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

export default router;
