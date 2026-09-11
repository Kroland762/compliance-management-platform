const { createHash, randomUUID } = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sequelize = require('../src/config/database').default;
const { config } = require('../src/config');
const settingsService = require('../src/services/settings.service').default;
const { AuthSession, RoleTemplate, Tenant, User } = require('../src/models');
const authService = require('../src/services/auth.service').default;

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function claims(tokenUse = 'refresh') {
  return {
    kind: 'control',
    tokenUse,
    sessionId: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    username: 'admin',
    tokenVersion: 1,
    isGlobalAdmin: true,
  };
}

function signedToken(tokenUse = 'refresh', overrides = {}) {
  return jwt.sign({ ...claims(tokenUse), ...overrides }, config.jwt.secret, {
    expiresIn: 60,
    jwtid: randomUUID(),
  });
}

function currentUser(overrides = {}) {
  return {
    id: claims().userId,
    username: 'admin',
    globalRoleTemplateId: '00000000-0000-4000-8000-000000000003',
    tokenVersion: 1,
    isActive: true,
    email: 'admin@example.com',
    mustChangePassword: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    passwordHash: 'password-hash',
    update: jest.fn(async function update(values) {
      Object.assign(this, values);
      return this;
    }),
    ...overrides,
  };
}

function activeSession(refreshToken) {
  return {
    id: claims().sessionId,
    userId: claims().userId,
    refreshTokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    update: jest.fn(async function update(values) {
      Object.assign(this, values);
      return this;
    }),
  };
}

describe('auth service security boundaries', () => {
  beforeEach(() => {
    jest.spyOn(sequelize, 'transaction')
      .mockImplementation((callback) => callback({ LOCK: { UPDATE: 'UPDATE' } }));
    jest.spyOn(Tenant, 'findAll').mockResolvedValue([]);
    jest.spyOn(RoleTemplate, 'findByPk').mockResolvedValue({
      name: '管理员',
      permissions: { dashboard: ['read'] },
      permissionScopes: { dashboard: { read: 'all' } },
    });
    jest.spyOn(settingsService, 'getSecuritySettings')
      .mockResolvedValue({ maxLoginAttempts: 5, lockDurationMinutes: 10 });
    jest.spyOn(AuthSession, 'create').mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  test('rejects a refresh token when it is used as an access bearer', async () => {
    const sessionLookup = jest.spyOn(AuthSession, 'findOne');

    await expect(authService.verifyTokenAndLoadUser(signedToken('refresh')))
      .rejects.toThrow('令牌无效或已过期');
    expect(sessionLookup).not.toHaveBeenCalled();
  });

  test('rejects legacy tokens without tokenUse and sessionId', async () => {
    const legacyToken = jwt.sign({ userId: claims().userId, kind: 'control', tokenVersion: 1 }, config.jwt.secret, {
      expiresIn: 60,
    });

    await expect(authService.refreshToken(legacyToken)).rejects.toThrow('令牌无效或已过期');
  });

  test('rejects refresh tokens with stale tokenVersion', async () => {
    jest.spyOn(User, 'findByPk').mockResolvedValue({ id: claims().userId, isActive: true, tokenVersion: 2 });

    await expect(authService.refreshToken(signedToken('refresh'))).rejects.toThrow('刷新令牌已失效');
    expect(RoleTemplate.findByPk).not.toHaveBeenCalled();
  });

  test('rotates a refresh token and rejects replay of the previous token', async () => {
    const refreshToken = signedToken('refresh');
    const user = currentUser();
    const session = activeSession(refreshToken);
    jest.spyOn(User, 'findByPk').mockResolvedValue(user);
    jest.spyOn(AuthSession, 'findOne').mockResolvedValue(session);

    const result = await authService.refreshToken(refreshToken);
    expect(result.token).not.toBe(result.refreshToken);
    expect(result.refreshToken).not.toBe(refreshToken);
    expect(session.refreshTokenHash).toBe(hashToken(result.refreshToken));

    await expect(authService.refreshToken(refreshToken)).rejects.toThrow('刷新令牌已失效');
  });

  test('revokes the server-side session on logout', async () => {
    const update = jest.spyOn(AuthSession, 'update').mockResolvedValue([1]);

    await expect(authService.revokeSession(signedToken('access'))).resolves.toMatchObject({
      userId: claims().userId,
      sessionId: claims().sessionId,
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ revokedAt: expect.any(Date) }),
      expect.objectContaining({ where: expect.objectContaining({ id: claims().sessionId, userId: claims().userId }) }),
    );
  });

  test('serializes failed-login updates so concurrent attempts are not lost', async () => {
    let releasePrevious = Promise.resolve();
    sequelize.transaction.mockImplementation(async (callback) => {
      const waitFor = releasePrevious;
      let release;
      releasePrevious = new Promise((resolve) => { release = resolve; });
      await waitFor;
      try {
        return await callback({ LOCK: { UPDATE: 'UPDATE' } });
      } finally {
        release();
      }
    });
    const snapshot = currentUser();
    const locked = currentUser();
    jest.spyOn(User, 'findOne').mockResolvedValue(snapshot);
    jest.spyOn(User, 'findByPk').mockResolvedValue(locked);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);

    const results = await Promise.allSettled([
      authService.login('admin', 'wrong-password', undefined, '0000'),
      authService.login('admin', 'wrong-password', undefined, '0000'),
    ]);

    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(locked.failedLoginAttempts).toBe(2);
    expect(AuthSession.create).not.toHaveBeenCalled();
  });
});
