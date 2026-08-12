import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const model = () => ({
    count: vi.fn(),
    findAll: vi.fn(),
    findByPk: vi.fn(),
    findOne: vi.fn(),
  });
  return {
    transaction,
    sequelizeTransaction: vi.fn(async (callback) => callback(transaction)),
    auditLog: vi.fn(),
    models: {
      AssessmentAsset: model(),
      AssessmentControlAsset: model(),
      AssessmentPlan: model(),
      Asset: model(),
      AuditLog: model(),
      AuditTask: model(),
      Department: model(),
      DepartmentMember: model(),
      Qualification: model(),
      QuestionItem: model(),
      RemediationAction: model(),
      RiskRecord: model(),
      TenantMember: model(),
      OperationType: { DELETE: 'delete' },
      TenantMemberStatus: { ACTIVE: 'active' },
    },
  };
});

vi.mock('../src/config/database', () => ({
  default: { transaction: mocks.sequelizeTransaction },
}));
vi.mock('../src/models', () => mocks.models);
vi.mock('../src/middlewares/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { userId: 'user-1', primaryDepartmentId: 'root-1' };
    req.tenant = { id: 'tenant-1' };
    next();
  },
  authorize: () => (_req, _res, next) => next(),
}));
vi.mock('../src/services/audit-log.service', () => ({
  default: { log: mocks.auditLog },
}));
vi.mock('../src/services/member.service', () => ({ default: {} }));

import departmentRouter from '../src/routes/department.routes';

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/departments', departmentRouter);
  instance.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { code: error.code || 'INTERNAL_ERROR', message: error.message },
    });
  });
  return instance;
}

function department(overrides = {}) {
  return {
    id: 'department-1',
    name: '待删除部门',
    code: 'DEPT-1',
    parentId: 'root-1',
    destroy: vi.fn(),
    ...overrides,
  };
}

describe('department deletion route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const model of Object.values(mocks.models)) {
      if (model && typeof model === 'object' && 'count' in model) model.count.mockResolvedValue(0);
    }
  });

  test('permanently deletes an unused non-root department in one transaction', async () => {
    const target = department();
    mocks.models.Department.findByPk.mockResolvedValue(target);

    const response = await request(app()).delete('/departments/department-1');

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('部门已删除');
    expect(target.destroy).toHaveBeenCalledWith({ transaction: mocks.transaction });
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({
      operationType: 'delete',
      resourceId: 'department-1',
    }), mocks.transaction);
  });

  test('never deletes a root department', async () => {
    const target = department({ parentId: null });
    mocks.models.Department.findByPk.mockResolvedValue(target);

    const response = await request(app()).delete('/departments/department-1');

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ROOT_DEPARTMENT_REQUIRED');
    expect(target.destroy).not.toHaveBeenCalled();
  });

  test('reports the business references that block deletion', async () => {
    const target = department();
    mocks.models.Department.findByPk.mockResolvedValue(target);
    mocks.models.Asset.count.mockResolvedValue(1);
    mocks.models.RiskRecord.count.mockResolvedValue(2);

    const response = await request(app()).delete('/departments/department-1');

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DEPARTMENT_IN_USE');
    expect(response.body.error.message).toContain('资产、风险');
    expect(target.destroy).not.toHaveBeenCalled();
  });
});
