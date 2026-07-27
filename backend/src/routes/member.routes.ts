import { Router } from 'express';
import Joi from 'joi';
import { authenticate, authorize } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import memberService from '../services/member.service';
import auditLogService from '../services/audit-log.service';
import { OperationType, TenantMember, TenantMemberStatus } from '../models';
import { AppError, asyncHandler } from '../utils/http';

const router = Router();
router.use(authenticate);

const uuid = Joi.string().uuid({ version: ['uuidv4'] });
const departmentAssignment = Joi.object({
  departmentId: uuid.required(),
  isPrimary: Joi.boolean().required(),
  positionTitle: Joi.string().trim().max(100).allow('', null).optional(),
});

const createMemberSchema = Joi.object({
  username: Joi.string().trim().min(3).max(50).required(),
  displayName: Joi.string().trim().min(1).max(100).required(),
  email: Joi.string().trim().email().max(200).allow('', null).optional(),
  employeeNo: Joi.string().trim().max(80).allow('', null).optional(),
  roleIds: Joi.array().items(uuid.required()).min(1).unique().required(),
  departments: Joi.array().items(departmentAssignment).min(1).required(),
});

router.get('/', authorize('users', 'read'), asyncHandler(async (req, res) => {
  const result = await memberService.list(req.query as Record<string, unknown>);
  res.json({ success: true, data: result });
}));

router.post(
  '/',
  authorize('users', 'create'),
  validate({ body: createMemberSchema }),
  asyncHandler(async (req, res) => {
    const result = await memberService.createLocal(req.body);
    await auditLogService.log({
      userId: req.user!.userId,
      operationType: OperationType.CREATE,
      resourceType: 'member',
      resourceId: result.member.id,
      operationDetails: `创建本地成员: ${req.body.username}`,
      success: true,
      ipAddress: req.ip,
      tenantId: req.tenant!.id,
      departmentId: req.user!.primaryDepartmentId,
    });
    res.status(201).json({
      success: true,
      data: {
        member: await memberService.toDto(result.member),
        temporaryPassword: result.temporaryPassword,
      },
    });
  }),
);

router.put('/:id', authorize('users', 'update'), asyncHandler(async (req, res) => {
  if (req.body.status && !Object.values(TenantMemberStatus).includes(req.body.status)) {
    throw new AppError(400, 'VALIDATION_ERROR', '成员状态非法');
  }
  const member = await memberService.updateMember(req.params.id, req.user!.memberId || '', req.body);
  await auditLogService.log({
    userId: req.user!.userId,
    operationType: OperationType.UPDATE,
    resourceType: 'member',
    resourceId: member.id,
    operationDetails: `更新成员: ${member.displayName}`,
    success: true,
    ipAddress: req.ip,
    tenantId: req.tenant!.id,
    departmentId: req.user!.primaryDepartmentId,
  });
  res.json({ success: true, data: await memberService.toDto(member) });
}));

router.put('/:id/roles', authorize('users', 'update'), asyncHandler(async (req, res) => {
  const roleIds = Array.isArray(req.body.roleIds) ? req.body.roleIds : [];
  await memberService.setRoles(req.params.id, req.user!.memberId || '', roleIds);
  await auditLogService.log({
    userId: req.user!.userId,
    operationType: OperationType.UPDATE,
    resourceType: 'member_roles',
    resourceId: req.params.id,
    operationDetails: `更新成员角色，角色数: ${roleIds.length}`,
    success: true,
    ipAddress: req.ip,
    tenantId: req.tenant!.id,
    departmentId: req.user!.primaryDepartmentId,
  });
  res.json({ success: true, message: '成员角色已更新' });
}));

router.put('/:id/departments', authorize('organization', 'update'), asyncHandler(async (req, res) => {
  const departments = Array.isArray(req.body.departments) ? req.body.departments : [];
  await memberService.setDepartments(req.params.id, departments);
  await auditLogService.log({
    userId: req.user!.userId,
    operationType: OperationType.UPDATE,
    resourceType: 'member_departments',
    resourceId: req.params.id,
    operationDetails: `更新成员部门，部门数: ${departments.length}`,
    success: true,
    ipAddress: req.ip,
    tenantId: req.tenant!.id,
    departmentId: req.user!.primaryDepartmentId,
  });
  res.json({ success: true, message: '成员部门已更新' });
}));

router.post('/invitations', authorize('users', 'create'), asyncHandler(async (req, res) => {
  const result = await memberService.createInvitation({
    targetUserId: req.body.targetUserId,
    targetUsername: req.body.targetUsername,
    roleIds: req.body.roleIds || [],
    departments: req.body.departments || [],
    createdBy: req.user!.userId,
  });
  await auditLogService.log({
    userId: req.user!.userId,
    operationType: OperationType.CREATE,
    resourceType: 'member_invitation',
    resourceId: result.invitation.id,
    operationDetails: '创建已有身份的租户邀请',
    success: true,
    ipAddress: req.ip,
    tenantId: req.tenant!.id,
    departmentId: req.user!.primaryDepartmentId,
  });
  res.status(201).json({
    success: true,
    data: {
      invitationId: result.invitation.id,
      token: result.token,
      expiresAt: result.invitation.expiresAt,
    },
  });
}));

router.get('/invitations', authorize('users', 'read'), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { items: await memberService.listInvitations() } });
}));

router.get('/:id', authorize('users', 'read'), asyncHandler(async (req, res) => {
  const member = await TenantMember.findByPk(req.params.id);
  if (!member) throw new AppError(404, 'NOT_FOUND', '成员不存在');
  res.json({ success: true, data: await memberService.toDto(member) });
}));

export default router;
