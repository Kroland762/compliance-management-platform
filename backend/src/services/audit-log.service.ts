import { AuditLog, OperationType } from '../models';
import { Op, type Transaction } from 'sequelize';
import settingsService from './settings.service';
import { parsePagination, pagination } from '../utils/pagination';

class AuditLogService {
  async log(data: {
    userId: string; operationType: OperationType; resourceType: string;
    resourceId?: string | null; operationDetails?: string; success: boolean;
    ipAddress?: string; tenantId?: string;
  }, transaction?: Transaction) {
    return AuditLog.create({
      userId: data.userId,
      operationType: data.operationType,
      resourceType: data.resourceType,
      resourceId: data.resourceId || null,
      operationDetails: data.operationDetails || null,
      success: data.success,
      ipAddress: data.ipAddress || null,
      tenantId: data.tenantId || null,
    } as any, { transaction });
  }

  async queryLogs(query: {
    page?: number; pageSize?: number; userId?: string;
    operationType?: OperationType; resourceType?: string;
    startDate?: string; endDate?: string; userSearch?: string;
  }) {
    const { page, pageSize } = parsePagination(query);
    const { userId, operationType, resourceType, startDate, endDate, userSearch } = query;
    const where: any = {};
    if (userId) where.userId = userId;
    if (operationType) where.operationType = operationType;
    if (resourceType) where.resourceType = resourceType;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    const include: any[] = [{ association: 'user', attributes: ['id', 'username'] }];
    if (userSearch) {
      include[0].where = { username: { [Op.like]: `%${userSearch}%` } };
      include[0].required = true;
    }

    const { count, rows } = await AuditLog.findAndCountAll({
      where,
      include,
      order: [['createdAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return {
      items: rows,
      pagination: pagination(page, pageSize, count),
    };
  }

  /**
   * 清理过期日志（根据 auditLogRetentionDays 设置）
   * @returns 删除的日志条数
   */
  async cleanupExpired(): Promise<number> {
    const { auditLogRetentionDays } = await settingsService.getSecuritySettings();
    if (auditLogRetentionDays <= 0) return 0; // 0 = 永久保留

    const cutoff = new Date(Date.now() - auditLogRetentionDays * 24 * 60 * 60 * 1000);
    const deleted = await AuditLog.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });
    return deleted;
  }
}

export default new AuditLogService();
