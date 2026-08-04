import { Router } from 'express';
import { authenticate, authorize, superAdminOnly } from '../middlewares/auth';
import Tenant, { TenantStatus } from '../models/Tenant';
import ControlAuditEvent from '../models/ControlAuditEvent';
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

router.get('/:id', authorize('tenants', 'read'), asyncHandler(async (req, res) => {
  const tenant = await Tenant.findByPk(req.params.id);
  if (!tenant) throw new AppError(404, 'NOT_FOUND', '租户不存在');
  res.json({ success: true, data: tenant });
}));

router.post('/', authorize('tenants', 'create'), asyncHandler(async (req, res) => {
  const result = await tenantProvisioningService.provision(req.body);
  const tenant = result.tenant;
  await ControlAuditEvent.create({
    eventType: 'tenant.created',
    actorUserId: req.user!.userId,
    tenantId: tenant.id,
    resourceType: 'tenant',
    resourceId: tenant.id,
    outcome: 'success',
    details: { name: tenant.name, slug: tenant.slug },
  });
  res.status(201).json({ success: true, data: result });
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
  tenant.status = TenantStatus.ARCHIVED;
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
  res.json({ success: true, message: '租户已归档；数据 schema 已保留，可通过恢复流程处理' });
}));

export default router;
