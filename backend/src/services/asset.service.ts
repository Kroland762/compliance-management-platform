import { Op } from 'sequelize';
import { Asset, Department, OperationType, TenantMember, TenantMemberStatus } from '../models';
import { AppError } from '../utils/http';
import { pagination, parsePagination } from '../utils/pagination';
import auditLogService from './audit-log.service';
import objectAccessService from './object-access.service';

type RequestUser = NonNullable<Express.Request['user']>;

interface AssetInput {
  code: string;
  name: string;
  assetType: string;
  criticality?: 'low' | 'medium' | 'high' | 'critical';
  ownerDepartmentId?: string | null;
  ownerUserId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
}

class AssetService {
  private async validateOwners(input: Pick<AssetInput, 'ownerDepartmentId' | 'ownerUserId'>): Promise<void> {
    if (input.ownerDepartmentId && !await Department.findOne({
      where: { id: input.ownerDepartmentId, status: 'active' },
    })) throw new AppError(404, 'NOT_FOUND', '资产责任部门不存在');
    if (input.ownerUserId && !await TenantMember.findOne({
      where: { userId: input.ownerUserId, status: TenantMemberStatus.ACTIVE },
    })) throw new AppError(404, 'NOT_FOUND', '资产负责人不存在');
  }

  async list(query: Record<string, unknown>, user: RequestUser) {
    const { page, pageSize } = parsePagination(query as any);
    const where: any = await objectAccessService.assetScope(user);
    if (query.status) where.status = query.status;
    if (query.assetType) where.assetType = query.assetType;
    if (query.criticality) where.criticality = query.criticality;
    if (query.ownerDepartmentId) where.ownerDepartmentId = query.ownerDepartmentId;
    if (query.keyword) {
      where[Op.or] = [
        { code: { [Op.iLike]: `%${query.keyword}%` } },
        { name: { [Op.iLike]: `%${query.keyword}%` } },
      ];
    }
    const { rows, count } = await Asset.findAndCountAll({
      where,
      order: [['status', 'ASC'], ['code', 'ASC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { items: rows, pagination: pagination(page, pageSize, count) };
  }

  async create(input: AssetInput, user: RequestUser): Promise<Asset> {
    const code = input.code?.trim().toUpperCase();
    if (!code || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(code)) {
      throw new AppError(400, 'VALIDATION_ERROR', '资产编码只能包含大写字母、数字、下划线和连字符');
    }
    if (code === 'ORG-GOVERNANCE') throw new AppError(409, 'CONFLICT', '系统资产编码不可使用');
    if (!input.name?.trim() || !input.assetType?.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', '资产名称和类型必填');
    }
    await this.validateOwners(input);
    if (await Asset.findOne({ where: { code } })) throw new AppError(409, 'CONFLICT', '资产编码已存在');
    const asset = await Asset.create({
      ...input,
      code,
      name: input.name.trim(),
      assetType: input.assetType.trim(),
      criticality: input.criticality || 'medium',
      metadata: input.metadata || {},
      status: 'active',
    });
    await auditLogService.log({
      userId: user.userId,
      operationType: OperationType.CREATE,
      resourceType: 'asset',
      resourceId: asset.id,
      operationDetails: `创建资产 ${asset.code}`,
      success: true,
      departmentId: asset.ownerDepartmentId || undefined,
    });
    return asset;
  }

  async update(id: string, input: Partial<Omit<AssetInput, 'code'>>, user: RequestUser): Promise<Asset> {
    const asset = await objectAccessService.assetOrNotFound(id, user, 'update');
    await this.validateOwners(input);
    if (input.name !== undefined && !input.name.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', '资产名称不能为空');
    }
    await asset.update({
      ...input,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.assetType !== undefined ? { assetType: input.assetType.trim() } : {}),
    });
    await auditLogService.log({
      userId: user.userId,
      operationType: OperationType.UPDATE,
      resourceType: 'asset',
      resourceId: asset.id,
      operationDetails: '更新资产资料',
      success: true,
      departmentId: asset.ownerDepartmentId || undefined,
    });
    return asset;
  }

  async archive(id: string, user: RequestUser): Promise<Asset> {
    const asset = await objectAccessService.assetOrNotFound(id, user, 'archive');
    if (asset.code === 'ORG-GOVERNANCE') {
      throw new AppError(409, 'CONFLICT', '组织级治理资产不可归档');
    }
    if (asset.status === 'archived') return asset;
    await asset.update({ status: 'archived', archivedAt: new Date() });
    await auditLogService.log({
      userId: user.userId,
      operationType: OperationType.UPDATE,
      resourceType: 'asset',
      resourceId: asset.id,
      operationDetails: '归档资产',
      success: true,
      departmentId: asset.ownerDepartmentId || undefined,
    });
    return asset;
  }
}

export default new AssetService();
