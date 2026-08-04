import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, test, vi } from 'vitest';
import authService from '../src/services/auth.service';
import { RoleTemplate, Tenant, User } from '../src/models';
import { TenantStatus } from '../src/models/Tenant';
import { config } from '../src/config';

const user = {
  id: 'user-1',
  username: 'auditor',
  email: 'auditor@example.test',
  isActive: true,
  tokenVersion: 1,
  mustChangePassword: false,
  globalRoleTemplateId: 'global-role-1',
};

const globalRole = {
  name: '全局管理员',
  permissions: { tasks: ['read'] },
  permissionScopes: { tasks: { read: 'all' } },
};

function tenantToken(tenantId = 'tenant-a') {
  return jwt.sign({
    kind: 'tenant',
    userId: user.id,
    username: user.username,
    tenantId,
    tokenVersion: 1,
    isGlobalAdmin: true,
  }, config.jwt.secret, { expiresIn: 60 });
}

describe('authenticated tenant context', () => {
  afterEach(() => vi.restoreAllMocks());

  test('rejects a signed tenant token after the tenant becomes inactive', async () => {
    vi.spyOn(User, 'findByPk').mockResolvedValue(user);
    vi.spyOn(RoleTemplate, 'findByPk').mockResolvedValue(globalRole);
    vi.spyOn(Tenant, 'findByPk').mockResolvedValue({
      id: 'tenant-a',
      status: TenantStatus.SUSPENDED,
    });

    await expect(authService.verifyTokenAndLoadUser(tenantToken()))
      .rejects.toMatchObject({ code: 'TENANT_INACTIVE', statusCode: 403 });
  });

  test('uses the database-confirmed active tenant context', async () => {
    vi.spyOn(User, 'findByPk').mockResolvedValue(user);
    vi.spyOn(RoleTemplate, 'findByPk').mockResolvedValue(globalRole);
    vi.spyOn(Tenant, 'findByPk').mockResolvedValue({
      id: 'tenant-a',
      name: '租户A',
      slug: 'tenant-a',
      status: TenantStatus.ACTIVE,
      schemaName: 'tenant_a',
    });

    await expect(authService.verifyTokenAndLoadUser(tenantToken()))
      .resolves.toMatchObject({ tenantId: 'tenant-a', tokenKind: 'tenant' });
  });
});
