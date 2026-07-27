import { Router } from 'express';
import { authenticate, authorize, superAdminOnly } from '../middlewares/auth';
import Tenant, { TenantStatus } from '../models/Tenant';
import ControlAuditEvent from '../models/ControlAuditEvent';
import User from '../models/User';
import tenantProvisioningService from '../services/tenant-provisioning.service';
import { AppError, asyncHandler } from '../utils/http';
import { pagination, parsePagination } from '../utils/pagination';

const router = Router();
router.use(authenticate, superAdminOnly);

router.get('/', authorize('tenants', 'read'), asyncHandler(async (req, res) => {
  const { page, pageSize } = parsePagination(req.query);
  const { count, rows } = await Tenant.findAndCountAll({
    order: [['createdAt', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  res.json({ success: true, data: { items: rows, pagination: pagination(page, pageSize, count) } });
}));

router.post('/:id/context', authorize('tenants', 'read'), asyncHandler(async (req, res) => {
  const tenant = await Tenant.findByPk(req.params.id);
  if (!tenant) throw new AppError(404, 'NOT_FOUND', '租户不存在');
  if (tenant.status !== TenantStatus.ACTIVE) throw new AppError(403, 'TENANT_INACTIVE', '租户已停用');
  await ControlAuditEvent.create({
    eventType: 'tenant.context.selected',
    actorUserId: req.user!.userId,
    tenantId: tenant.id,
    resourceType: 'tenant',
    resourceId: tenant.id,
    outcome: 'success',
    details: { name: tenant.name, schemaName: tenant.schemaName },
  });
  res.json({
    success: true,
    data: { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status },
  });
}));

router.get('/:id/users', authorize('tenants', 'read'), asyncHandler(async (req, res) => {
  const tenant = await Tenant.findByPk(req.params.id);
  if (!tenant) throw new AppError(404, 'NOT_FOUND', '租户不存在');
  const { page, pageSize } = parsePagination(req.query);
  const { count, rows } = await User.findAndCountAll({
    where: { tenantId: tenant.id },
    attributes: { exclude: ['passwordHash'] },
    order: [['createdAt', 'ASC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  res.json({ success: true, data: { items: rows, pagination: pagination(page, pageSize, count) } });
}));

router.get('/:id', authorize('tenants', 'read'), asyncHandler(async (req, res) => {
  const tenant = await Tenant.findByPk(req.params.id);
  if (!tenant) throw new AppError(404, 'NOT_FOUND', '租户不存在');
  res.json({ success: true, data: tenant });
}));

router.post('/', authorize('tenants', 'create'), asyncHandler(async (req, res) => {
  const tenant = await tenantProvisioningService.provision(req.body);
  await ControlAuditEvent.create({
    eventType: 'tenant.created',
    actorUserId: req.user!.userId,
    tenantId: tenant.id,
    resourceType: 'tenant',
    resourceId: tenant.id,
    outcome: 'success',
    details: { name: tenant.name, slug: tenant.slug },
  });
  res.status(201).json({ success: true, data: tenant });
}));

router.put('/:id', authorize('tenants', 'update'), asyncHandler(async (req, res) => {
  const tenant = await Tenant.findByPk(req.params.id);
  if (!tenant) throw new AppError(404, 'NOT_FOUND', '租户不存在');
  const { name, domain, status } = req.body;
  if (name !== undefined) tenant.name = String(name).trim();
  if (domain !== undefined) tenant.domain = domain ? String(domain).trim() : null;
  if (status !== undefined) {
    if (!Object.values(TenantStatus).includes(status)) throw new AppError(400, 'VALIDATION_ERROR', '租户状态非法');
    tenant.status = status;
  }
  await tenant.save();
  await ControlAuditEvent.create({
    eventType: 'tenant.updated',
    actorUserId: req.user!.userId,
    tenantId: tenant.id,
    resourceType: 'tenant',
    resourceId: tenant.id,
    outcome: 'success',
    details: { status: tenant.status },
  });
  res.json({ success: true, data: tenant });
}));

router.delete('/:id', authorize('tenants', 'delete'), asyncHandler(async (req, res) => {
  const tenant = await Tenant.findByPk(req.params.id);
  if (!tenant) throw new AppError(404, 'NOT_FOUND', '租户不存在');
  tenant.status = TenantStatus.SUSPENDED;
  await tenant.save();
  await ControlAuditEvent.create({
    eventType: 'tenant.suspended',
    actorUserId: req.user!.userId,
    tenantId: tenant.id,
    resourceType: 'tenant',
    resourceId: tenant.id,
    outcome: 'success',
    details: { preservedSchema: tenant.schemaName },
  });
  res.json({ success: true, message: '租户已停用；数据 schema 已保留，可通过备份恢复流程处理' });
}));

export default router;
