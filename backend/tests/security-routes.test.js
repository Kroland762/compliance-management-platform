jest.mock('../src/services/account/auditTask.service', () => ({
  __esModule: true,
  default: {
    executeTask: jest.fn().mockResolvedValue({ id: 'execution-1' }),
  },
}));

jest.mock('../src/services/notification.service', () => ({
  __esModule: true,
  default: {
    markAsRead: jest.fn().mockResolvedValue({ id: 'notification-1' }),
  },
}));

jest.mock('../src/services/task.service', () => ({
  __esModule: true,
  default: {
    syncColumnSchema: jest.fn().mockResolvedValue({ columnSchemaSnapshot: [] }),
  },
}));

jest.mock('../src/services/object-access.service', () => ({
  __esModule: true,
  default: {
    taskOrNotFound: jest.fn().mockResolvedValue({ id: 'task-1' }),
  },
}));

const express = require('express');
const request = require('supertest');
const accountTaskRouter = require('../src/routes/account/task.routes').default;
const notificationRouter = require('../src/routes/notification.routes').default;
const taskRouter = require('../src/routes/task.routes').default;
const auditTaskService = require('../src/services/account/auditTask.service').default;
const notificationService = require('../src/services/notification.service').default;
const taskService = require('../src/services/task.service').default;
const { captchaLimiter } = require('../src/middlewares/rateLimiter');

function user(permissions) {
  return {
    userId: 'user-1',
    username: 'tester',
    role: '测试角色',
    roleIds: ['role-1'],
    permissions,
    permissionScopes: {},
    departmentIds: [],
    mustChangePassword: false,
    isGlobalAdmin: false,
    tokenKind: 'tenant',
    sessionId: 'session-1',
  };
}

function appFor(router, prefix, permissions) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user(permissions);
    next();
  });
  app.use(prefix, router);
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({ error: { code: error.code || 'ERROR' } });
  });
  return app;
}

describe('security-sensitive route authorization', () => {
  beforeEach(() => jest.clearAllMocks());

  test('account task execution denies read-only roles', async () => {
    const response = await request(appFor(accountTaskRouter, '/api/account/tasks', {
      account_tasks: ['read'],
    })).post('/api/account/tasks/task-1/execute');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(auditTaskService.executeTask).not.toHaveBeenCalled();
  });

  test('account task execution remains available with execute permission', async () => {
    const response = await request(appFor(accountTaskRouter, '/api/account/tasks', {
      account_tasks: ['read', 'execute'],
    })).post('/api/account/tasks/task-1/execute');

    expect(response.status).toBe(200);
    expect(auditTaskService.executeTask).toHaveBeenCalledWith('task-1', 'user-1');
  });

  test('notification mark-as-read requires update permission', async () => {
    const denied = await request(appFor(notificationRouter, '/api/notifications', {
      notifications: ['read'],
    })).put('/api/notifications/notification-1/read');
    expect(denied.status).toBe(403);
    expect(notificationService.markAsRead).not.toHaveBeenCalled();

    const allowed = await request(appFor(notificationRouter, '/api/notifications', {
      notifications: ['read', 'update'],
    })).put('/api/notifications/notification-1/read');
    expect(allowed.status).toBe(200);
    expect(notificationService.markAsRead).toHaveBeenCalledWith('notification-1', 'user-1');
  });

  test('template column synchronization requires task update permission', async () => {
    const denied = await request(appFor(taskRouter, '/api/tasks', {
      tasks: ['read'],
    })).put('/api/tasks/task-1/column-schema/sync');
    expect(denied.status).toBe(403);
    expect(taskService.syncColumnSchema).not.toHaveBeenCalled();

    const allowed = await request(appFor(taskRouter, '/api/tasks', {
      tasks: ['update'],
    })).put('/api/tasks/task-1/column-schema/sync');
    expect(allowed.status).toBe(200);
    expect(taskService.syncColumnSchema).toHaveBeenCalledWith('task-1', 'user-1');
  });

  test('captcha requests are limited to 30 per IP and minute', async () => {
    const app = express();
    app.get('/captcha', captchaLimiter, (_req, res) => res.json({ success: true }));
    for (let index = 0; index < 30; index += 1) {
      const response = await request(app).get('/captcha');
      expect(response.status).toBe(200);
    }
    const limited = await request(app).get('/captcha');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});
