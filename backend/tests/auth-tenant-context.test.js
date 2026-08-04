import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, test, vi } from 'vitest';
import authService from '../src/services/auth.service';
import { Role, User } from '../src/models';
import { config } from '../src/config';

describe('authenticated tenant context', () => {
  afterEach(() => vi.restoreAllMocks());

  test('rejects a valid token after the user tenant changes in the database', async () => {
    vi.spyOn(Role, 'findByPk').mockResolvedValue({ name: '审计员', permissions: { tasks: ['read'] } });
    vi.spyOn(User, 'findByPk').mockResolvedValue({ isActive: true, tokenVersion: 1, tenantId: 'tenant-b' });
    const token = jwt.sign({
      userId: 'user-1', username: 'auditor', role: '审计员', roleId: 'role-1',
      tenantId: 'tenant-a', tokenVersion: 1,
    }, config.jwt.secret, { expiresIn: 60 });

    await expect(authService.verifyTokenAndLoadUser(token)).rejects.toThrow(/租户上下文已变更/);
  });

  test('uses the database-confirmed tenant when token and user match', async () => {
    vi.spyOn(Role, 'findByPk').mockResolvedValue({ name: '审计员', permissions: { tasks: ['read'] } });
    vi.spyOn(User, 'findByPk').mockResolvedValue({ isActive: true, tokenVersion: 1, tenantId: 'tenant-a' });
    const token = jwt.sign({
      userId: 'user-1', username: 'auditor', role: '审计员', roleId: 'role-1',
      tenantId: 'tenant-a', tokenVersion: 1,
    }, config.jwt.secret, { expiresIn: 60 });

    await expect(authService.verifyTokenAndLoadUser(token)).resolves.toMatchObject({ tenantId: 'tenant-a' });
  });
});
