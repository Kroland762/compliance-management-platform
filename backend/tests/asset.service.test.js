import { afterEach, describe, expect, test, vi } from 'vitest';
import assetService from '../src/services/asset.service';
import auditLogService from '../src/services/audit-log.service';
import objectAccessService from '../src/services/object-access.service';

const actor = {
  userId: 'user-1',
  username: 'user-1',
  role: 'admin',
  roleIds: [],
  tenantId: 'tenant-1',
  permissions: { assets: ['read', 'update', 'archive'] },
  permissionScopes: { assets: { read: 'all', update: 'all', archive: 'all' } },
  departmentIds: [],
  isGlobalAdmin: false,
  tokenKind: 'tenant',
};

function asset(overrides = {}) {
  const model = {
    id: 'asset-1',
    code: 'APP-001',
    name: '应用一',
    assetType: 'application',
    criticality: 'medium',
    ownerDepartmentId: null,
    ownerUserId: null,
    description: null,
    metadata: {},
    status: 'active',
    archivedAt: null,
    update: vi.fn(async (values) => {
      Object.assign(model, values);
      return model;
    }),
    ...overrides,
  };
  return model;
}

describe('asset service lifecycle', () => {
  afterEach(() => vi.restoreAllMocks());

  test('update only writes editable fields and keeps code and status immutable', async () => {
    const model = asset();
    vi.spyOn(objectAccessService, 'assetOrNotFound').mockResolvedValue(model);
    vi.spyOn(auditLogService, 'log').mockResolvedValue({});

    await assetService.update('asset-1', {
      code: 'HACKED',
      status: 'archived',
      name: '  更新后的应用  ',
    }, actor);

    expect(model.update).toHaveBeenCalledWith({ name: '更新后的应用' });
    expect(model.code).toBe('APP-001');
    expect(model.status).toBe('active');
  });

  test('archived assets must be restored before editing', async () => {
    const model = asset({ status: 'archived' });
    vi.spyOn(objectAccessService, 'assetOrNotFound').mockResolvedValue(model);

    await expect(assetService.update('asset-1', { name: '新名称' }, actor))
      .rejects.toMatchObject({ code: 'ASSET_ARCHIVED', statusCode: 409 });
    expect(model.update).not.toHaveBeenCalled();
  });

  test('restore reactivates an archived asset and clears its archive time', async () => {
    const model = asset({ status: 'archived', archivedAt: new Date() });
    vi.spyOn(objectAccessService, 'assetOrNotFound').mockResolvedValue(model);
    vi.spyOn(auditLogService, 'log').mockResolvedValue({});

    await assetService.restore('asset-1', actor);

    expect(model.update).toHaveBeenCalledWith({ status: 'active', archivedAt: null });
    expect(auditLogService.log).toHaveBeenCalledWith(expect.objectContaining({
      resourceId: 'asset-1',
      operationDetails: '恢复资产',
    }));
  });
});
