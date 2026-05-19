import { AuditLog, OperationType } from '../models';
import { Op } from 'sequelize';

class AuditLogService {
  async log(data: {
    userId: string; operationType: OperationType; resourceType: string;
    resourceId?: string | null; operationDetails?: string; success: boolean;
    ipAddress?: string;
  }) {
    return AuditLog.create({
      userId: data.userId,
      operationType: data.operationType,
      resourceType: data.resourceType,
      resourceId: data.resourceId || null,
      operationDetails: data.operationDetails || null,
      success: data.success,
      ipAddress: data.ipAddress || null,
    } as any);
  }

  async queryLogs(query: {
    page?: number; pageSize?: number; userId?: string;
    operationType?: OperationType; resourceType?: string;
    startDate?: string; endDate?: string;
  }) {
    const { page = 1, pageSize = 20, userId, operationType, resourceType, startDate, endDate } = query;
    const where: any = {};
    if (userId) where.userId = userId;
    if (operationType) where.operationType = operationType;
    if (resourceType) where.resourceType = resourceType;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    const { count, rows } = await AuditLog.findAndCountAll({
      where,
      include: [{ association: 'user', attributes: ['id', 'username'] }],
      order: [['createdAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return {
      items: rows,
      pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
    };
  }
}

export default new AuditLogService();
