jest.mock('../src/services/auth.service', () => ({
  __esModule: true,
  default: { verifyTokenAndLoadUser: jest.fn() },
}));

const { authorize, authorizeAny, superAdminOnly } = require('../src/middlewares/auth');

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status: jest.fn(function status(code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(payload) {
      this.body = payload;
      return this;
    }),
  };
}

function createUser(overrides = {}) {
  return {
    userId: 'user-1',
    username: 'tester',
    role: '测试角色',
    roleId: 'role-1',
    permissions: {},
    ...overrides,
  };
}

describe('auth authorization middleware', () => {
  test('authorize returns 401 when user is missing', () => {
    const req = {};
    const res = createResponse();
    const next = jest.fn();

    authorize('users', 'read')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(next).not.toHaveBeenCalled();
  });

  test('authorize allows users with the requested permission', () => {
    const req = { user: createUser({ tenantId: 'tenant-1', permissions: { users: ['read'] } }) };
    const res = createResponse();
    const next = jest.fn();

    authorize('users', 'read')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('authorize does not treat global users as super admins without explicit bypass', () => {
    const req = { user: createUser({ permissions: { users: ['read'] } }) };
    const res = createResponse();
    const next = jest.fn();

    authorize('tenants', 'read')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(next).not.toHaveBeenCalled();
  });

  test('authorize allows requests after superAdminOnly sets the explicit bypass flag', () => {
    const req = {
      user: createUser({ permissions: { tenants: ['create', 'read', 'update', 'delete'] } }),
    };
    const res = createResponse();
    const next = jest.fn();

    superAdminOnly(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req._isSuperAdmin).toBe(true);

    const authorizeNext = jest.fn();
    authorize('users', 'delete')(req, createResponse(), authorizeNext);

    expect(authorizeNext).toHaveBeenCalledTimes(1);
  });

  test('superAdminOnly rejects tenant-scoped users even with tenant permissions', () => {
    const req = {
      user: createUser({
        tenantId: 'tenant-1',
        permissions: { tenants: ['create', 'read', 'update', 'delete'] },
      }),
    };
    const res = createResponse();
    const next = jest.fn();

    superAdminOnly(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(req._isSuperAdmin).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });

  test('superAdminOnly rejects global users without full tenant management permissions', () => {
    const req = { user: createUser({ permissions: { tenants: ['read'] } }) };
    const res = createResponse();
    const next = jest.fn();

    superAdminOnly(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(req._isSuperAdmin).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });

  test('authorizeAny allows one matching permission and denies when none match', () => {
    const allowedReq = { user: createUser({ tenantId: 'tenant-1', permissions: { risks: ['read'] } }) };
    const allowedNext = jest.fn();
    authorizeAny(['users', 'read'], ['risks', 'read'])(allowedReq, createResponse(), allowedNext);
    expect(allowedNext).toHaveBeenCalledTimes(1);

    const deniedReq = { user: createUser({ tenantId: 'tenant-1', permissions: { risks: ['read'] } }) };
    const deniedRes = createResponse();
    const deniedNext = jest.fn();
    authorizeAny(['users', 'read'], ['risks', 'update'])(deniedReq, deniedRes, deniedNext);
    expect(deniedRes.status).toHaveBeenCalledWith(403);
    expect(deniedNext).not.toHaveBeenCalled();
  });
});
