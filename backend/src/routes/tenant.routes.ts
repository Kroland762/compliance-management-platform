import { Router, Request, Response } from 'express';
import sequelize from '../config/database';
import { authenticate, authorize, superAdminOnly } from '../middlewares/auth';
import Tenant, { TenantStatus } from '../models/Tenant';
import auditLogService from '../services/audit-log.service';
import { OperationType } from '../models';

const router = Router();
router.use(authenticate);

// 所有租户管理操作仅全局超管可用
router.use(superAdminOnly);

// 需要复制的模型表名列表
const TENANT_TABLES = [
  'users', 'roles', 'audit_tasks', 'questionnaire_templates', 'question_templates',
  'question_items', 'risk_records', 'evidence_files', 'notifications', 'audit_logs',
  'account_data', 'account_data_sources', 'account_audit_rules', 'account_audit_tasks',
  'account_problems', 'account_task_executions', 'system_settings',
];

/**
 * GET /api/tenants
 * 租户列表
 */
router.get('/', authorize('tenants', 'read'), async (_req: Request, res: Response) => {
  try {
    const tenants = await Tenant.findAll({
      order: [['createdAt', 'DESC']],
      attributes: { exclude: [] },
    });
    res.json({ success: true, data: tenants });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * GET /api/tenants/:id
 * 租户详情
 */
router.get('/:id', authorize('tenants', 'read'), async (req: Request, res: Response) => {
  try {
    const tenant = await Tenant.findByPk(req.params.id);
    if (!tenant) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '租户不存在' } });
      return;
    }
    res.json({ success: true, data: tenant });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * POST /api/tenants
 * 创建租户（含独立 schema + 表结构 + 默认角色）
 */
router.post('/', authorize('tenants', 'create'), async (req: Request, res: Response) => {
  try {
    const { name, slug, domain } = req.body;
    if (!name || !slug) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: '租户名称和标识为必填项' } });
      return;
    }

    const schemaName = `tenant_${slug}`;

    // 检查是否已存在
    const existing = await Tenant.findOne({ where: { slug } });
    if (existing) {
      res.status(400).json({ success: false, error: { code: 'DUPLICATE', message: `租户标识 "${slug}" 已存在` } });
      return;
    }

    // 1. 创建 PostgreSQL schema
    await sequelize.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);

    // 2. 在租户 schema 内创建业务表（LIKE public 表结构）
    for (const table of TENANT_TABLES) {
      await sequelize.query(
        `CREATE TABLE IF NOT EXISTS "${schemaName}"."${table}" (LIKE public."${table}" INCLUDING ALL)`
      ).catch(() => {}); // 忽略已存在的表
    }

    // 3. 复制默认角色到租户 schema
    const publicRoles = await sequelize.query(
      `SELECT name, description, permissions, "isSystem", "createdAt", "updatedAt" FROM public.roles WHERE "isSystem" = true`,
      { type: 'SELECT' }
    ) as any[];

    for (const r of publicRoles) {
      await sequelize.query(`
        INSERT INTO "${schemaName}".roles (name, description, permissions, "isSystem", "createdAt", "updatedAt")
        VALUES (:name, :description, :permissions, :isSystem, :createdAt, :updatedAt)
        ON CONFLICT (name) DO NOTHING
      `, { replacements: r }).catch(() => {});
    }

    // 4. 创建租户记录
    const tenant = await Tenant.create({
      name,
      slug,
      domain: domain || null,
      status: TenantStatus.ACTIVE,
      schemaName,
    });

    await auditLogService.log({
      userId: req.user!.userId,
      operationType: OperationType.CREATE,
      resourceType: 'tenant',
      resourceId: tenant.id,
      operationDetails: `创建租户: ${name} (${slug}), schema: ${schemaName}`,
      success: true,
    });

    res.status(201).json({
      success: true,
      data: tenant,
      message: `租户 "${name}" 创建成功，schema: ${schemaName}`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'CREATE_FAILED', message: error.message } });
  }
});

/**
 * PUT /api/tenants/:id
 * 更新租户信息
 */
router.put('/:id', authorize('tenants', 'update'), async (req: Request, res: Response) => {
  try {
    const tenant = await Tenant.findByPk(req.params.id);
    if (!tenant) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '租户不存在' } });
      return;
    }

    const { name, domain, status } = req.body;
    if (name !== undefined) tenant.name = name;
    if (domain !== undefined) tenant.domain = domain;
    if (status !== undefined) tenant.status = status;

    await tenant.save();

    await auditLogService.log({
      userId: req.user!.userId,
      operationType: OperationType.UPDATE,
      resourceType: 'tenant',
      resourceId: tenant.id,
      operationDetails: `更新租户: ${tenant.name}`,
      success: true,
    });

    res.json({ success: true, data: tenant });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

/**
 * DELETE /api/tenants/:id
 * 删除租户（级联删除 schema）
 */
router.delete('/:id', authorize('tenants', 'delete'), async (req: Request, res: Response) => {
  try {
    const tenant = await Tenant.findByPk(req.params.id);
    if (!tenant) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '租户不存在' } });
      return;
    }

    const schemaName = tenant.schemaName;
    await tenant.destroy();

    // 删除整个 schema（级联删除所有数据）
    await sequelize.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);

    await auditLogService.log({
      userId: req.user!.userId,
      operationType: OperationType.DELETE,
      resourceType: 'tenant',
      resourceId: tenant.id,
      operationDetails: `删除租户: ${tenant.name}, schema: ${schemaName}`,
      success: true,
    });

    res.json({ success: true, message: `租户 "${tenant.name}" 已删除，schema ${schemaName} 已清理` });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
});

/**
 * GET /api/tenants/:id/users
 * 获取租户下的用户列表
 */
router.get('/:id/users', authorize('tenants', 'read'), async (req: Request, res: Response) => {
  try {
    const { User } = await import('../models');
    const users = await User.findAll({
      where: { tenantId: req.params.id },
      attributes: { exclude: ['passwordHash'] },
      order: [['createdAt', 'ASC']],
    });
    res.json({ success: true, data: users });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

export default router;
