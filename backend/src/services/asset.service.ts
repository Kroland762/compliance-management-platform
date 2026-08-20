import { Op } from 'sequelize';
import { Asset, OperationType } from '../models';
import { AppError } from '../utils/http';
import { pagination, parsePagination } from '../utils/pagination';
import auditLogService from './audit-log.service';
import objectAccessService from './object-access.service';
import lookupService from './lookup.service';

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
  private async validateOwners(input: Pick<AssetInput, 'ownerDepartmentId' | 'ownerUserId'>, user: RequestUser, contextId = ''): Promise<void> {
    await lookupService.assertOwners('asset-owner', input.ownerDepartmentId, input.ownerUserId, user, contextId);
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
    if (!input.name?.trim() || !input.assetType?.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', '资产名称和类型必填');
    }
    await this.validateOwners(input, user);
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
    if (asset.status !== 'active') {
      throw new AppError(409, 'ASSET_ARCHIVED', '已归档资产不可编辑，请先恢复');
    }
    await this.validateOwners(input, user, id);
    if (input.name !== undefined && !input.name.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', '资产名称不能为空');
    }
    if (input.assetType !== undefined && !input.assetType.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', '资产类型不能为空');
    }
    const updates: Partial<AssetInput> = {};
    if (input.name !== undefined) updates.name = input.name.trim();
    if (input.assetType !== undefined) updates.assetType = input.assetType.trim();
    if (input.criticality !== undefined) updates.criticality = input.criticality;
    if (input.ownerDepartmentId !== undefined) updates.ownerDepartmentId = input.ownerDepartmentId || null;
    if (input.ownerUserId !== undefined) updates.ownerUserId = input.ownerUserId || null;
    if (input.description !== undefined) updates.description = input.description || null;
    if (input.metadata !== undefined) updates.metadata = input.metadata;
    await asset.update(updates);
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

  async restore(id: string, user: RequestUser): Promise<Asset> {
    const asset = await objectAccessService.assetOrNotFound(id, user, 'archive');
    if (asset.status === 'active') return asset;
    await asset.update({ status: 'active', archivedAt: null });
    await auditLogService.log({
      userId: user.userId,
      operationType: OperationType.UPDATE,
      resourceType: 'asset',
      resourceId: asset.id,
      operationDetails: '恢复资产',
      success: true,
      departmentId: asset.ownerDepartmentId || undefined,
    });
    return asset;
  }
}

export default new AssetService();
