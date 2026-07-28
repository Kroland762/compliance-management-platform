jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
  sign: jest.fn(() => 'signed-token'),
}));

jest.mock('../src/models/index', () => ({
  User: { findByPk: jest.fn() },
  Role: { findByPk: jest.fn() },
  RoleTemplate: { findByPk: jest.fn() },
  Tenant: { findByPk: jest.fn(), findAll: jest.fn().mockResolvedValue([]) },
  OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE' },
}));

jest.mock('../src/services/settings.service', () => ({
  __esModule: true,
  default: { getSecuritySettings: jest.fn() },
}));

jest.mock('../src/services/captcha.service', () => ({
  __esModule: true,
  default: { verify: jest.fn(), generate: jest.fn() },
}));

jest.mock('../src/services/audit-log.service', () => ({
  __esModule: true,
  default: { log: jest.fn() },
}));

const jwt = require('jsonwebtoken');
const { User, RoleTemplate } = require('../src/models/index');
const authService = require('../src/services/auth.service').default;

describe('auth service refresh token revocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jwt.verify.mockReturnValue({
      userId: 'user-1',
      username: 'admin',
      role: '管理员',
      roleId: 'role-1',
      tokenVersion: 1,
    });
  });

  test('rejects refresh tokens with stale tokenVersion', async () => {
    User.findByPk.mockResolvedValue({ id: 'user-1', isActive: true, tokenVersion: 2 });

    await expect(authService.refreshToken('old-refresh-token')).rejects.toThrow('刷新令牌已失效');
    expect(RoleTemplate.findByPk).not.toHaveBeenCalled();
  });

  test('allows refresh tokens with current tokenVersion', async () => {
    User.findByPk.mockResolvedValue({
      id: 'user-1',
      username: 'admin',
      globalRoleTemplateId: 'role-1',
      tokenVersion: 1,
      isActive: true,
      email: 'admin@example.com',
      mustChangePassword: false,
    });
    RoleTemplate.findByPk.mockResolvedValue({
      name: '管理员',
      permissions: { dashboard: ['read'] },
      permissionScopes: { dashboard: { read: 'all' } },
    });

    const result = await authService.refreshToken('current-refresh-token');

    expect(result.token).toBe('signed-token');
    expect(result.refreshToken).toBe('signed-token');
    expect(result.user.permissions).toEqual({ dashboard: ['read'] });
  });
});
