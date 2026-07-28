import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import settingsService from '../services/settings.service';
import auditLogService from '../services/audit-log.service';
import sequelize from '../config/database';
import { OperationType } from '../models';
import { asyncHandler } from '../utils/http';

const router = Router();
router.use(authenticate);

/**
 * GET /api/settings/security
 * 获取安全设置（所有登录用户可读，用于前端读取空闲超时等）
 */
router.get('/security', asyncHandler(async (_req, res) => {
  const settings = await settingsService.getSecuritySettings();
  res.json({ success: true, data: settings });
}));

/**
 * PUT /api/settings/security
 * 更新安全设置（仅管理员）
 */
router.put('/security', authorize('settings', 'update'), asyncHandler(async (req, res) => {
  const settings = await sequelize.transaction(async (transaction) => {
    const before = await settingsService.getSecuritySettings(transaction);
    const updated = await settingsService.updateSecuritySettings(req.body, req.user!.userId, transaction);
    const changes = (Object.keys(updated) as Array<keyof typeof updated>)
      .filter((key) => before[key] !== updated[key])
      .map((key) => `${key}: ${before[key]} -> ${updated[key]}`);

    await auditLogService.log({
      userId: req.user!.userId,
      operationType: OperationType.UPDATE,
      resourceType: 'security_settings',
      operationDetails: changes.length
        ? `更新安全设置：${changes.join('；')}`
        : '保存安全设置（无字段变化）',
      success: true,
      ipAddress: req.ip,
      tenantId: req.tenant?.id,
      departmentId: req.user!.primaryDepartmentId,
    }, transaction);
    return updated;
  });
  settingsService.invalidateCache();
  res.json({ success: true, data: settings });
}));

export default router;
