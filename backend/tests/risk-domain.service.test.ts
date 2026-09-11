import { afterEach, describe, expect, test, vi } from 'vitest';
import { Op } from 'sequelize';
import { RiskDiscoverySource, RiskLevel, RiskRecord, RiskSource, RiskFindingLink, RiskAffectedAsset, Finding, Department, TenantMember } from '../src/models';
import sequelize from '../src/config/database';
import riskDomainService from '../src/services/risk-domain.service';
import objectAccessService from '../src/services/object-access.service';

const user = { userId: 'creator', permissions: { risks: ['create'] }, permissionScopes: {}, isGlobalAdmin: false } as any;
const base = {
  title: '运维发现的风险', description: '日常巡检中发现', riskLevel: RiskLevel.HIGH,
  ownerDepartmentId: 'department', ownerUserId: 'owner', assets: [{ assetId: 'asset' }],
};

describe('independent risk creation contract', () => {
  afterEach(() => vi.restoreAllMocks());
  test('rejects a client-forged creation mode', async () => {
    await expect(riskDomainService.create({ ...base, creationMode: 'manual' } as any, user, 'key'))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });

  test('rejects mixed assessment and manual source fields', async () => {
    await expect(riskDomainService.create({
      ...base, taskId: 'task', sources: [{ controlEvaluationId: 'evaluation' }],
      discoverySource: RiskDiscoverySource.DAILY_OPERATIONS,
    } as any, user, 'key')).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });

  test('requires task and evaluation sources together', async () => {
    await expect(riskDomainService.create({ ...base, taskId: 'task' } as any, user, 'key'))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });

  test('requires a non-assessment discovery source, detail and independent reviewer', async () => {
    await expect(riskDomainService.create({ ...base, discoverySource: RiskDiscoverySource.COMPLIANCE_ASSESSMENT } as any, user, 'key'))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    await expect(riskDomainService.create({ ...base, discoverySource: RiskDiscoverySource.DAILY_OPERATIONS } as any, user, 'key'))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    await expect(riskDomainService.create({ ...base, discoverySource: RiskDiscoverySource.DAILY_OPERATIONS,
      discoverySourceDetail: '巡检', reviewerUserId: user.userId } as any, user, 'key'))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });

  test('keeps object access and exact task filtering when keyword filters are added', async () => {
    const access = { reviewerUserId: user.userId };
    vi.spyOn(objectAccessService, 'riskScope').mockResolvedValue(access);
    const query = vi.spyOn(RiskRecord, 'findAndCountAll').mockResolvedValue({ rows: [], count: 0 } as any);

    await riskDomainService.list({ taskId: 'task-1', keyword: 'daily' }, user);

    const where: any = query.mock.calls[0][0]?.where;
    expect(where.taskId).toBe('task-1');
    expect(where[Op.and][0]).toBe(access);
    expect(where[Op.and][1][Op.or]).toHaveLength(2);
  });

  test.each(['open', 'closed'])('intersects overdue with explicit %s status instead of replacing it', async (status) => {
    vi.spyOn(objectAccessService, 'riskScope').mockResolvedValue({});
    const query = vi.spyOn(RiskRecord, 'findAndCountAll').mockResolvedValue({ rows: [], count: 0 } as any);
    await riskDomainService.list({ status, overdue: true }, user);
    const where: any = query.mock.calls[0][0]?.where;
    expect(where.status).toBe(status);
    expect(where[Op.and]).toContainEqual({ status: { [Op.notIn]: ['closed', 'cancelled'] } });
    expect(where.dueDate[Op.lt]).toBeInstanceOf(Date);
  });

  test('confirmation rejects equally sized source and finding sets that refer to different evaluations', async () => {
    const update = vi.fn();
    const risk = { id: 'risk', taskId: 'task', creationMode: 'evaluation', discoverySource: 'compliance_assessment',
      status: 'pending_confirmation', lockVersion: 1, ownerDepartmentId: 'department', ownerUserId: 'owner', update } as any;
    vi.spyOn(objectAccessService, 'riskOrNotFound').mockResolvedValue(risk);
    vi.spyOn(sequelize, 'transaction').mockImplementation(async (callback: any) => callback({ LOCK: { UPDATE: 'UPDATE' } }));
    vi.spyOn(RiskRecord, 'findByPk').mockResolvedValue(risk);
    vi.spyOn(RiskAffectedAsset, 'count').mockResolvedValue(1);
    vi.spyOn(Department, 'findOne').mockResolvedValue({} as any);
    vi.spyOn(TenantMember, 'findOne').mockResolvedValue({} as any);
    vi.spyOn(RiskSource, 'findAll').mockResolvedValue([{ controlEvaluationId: 'evaluation-a' }] as any);
    vi.spyOn(RiskFindingLink, 'findAll').mockResolvedValue([{ findingId: 'finding-b' }] as any);
    vi.spyOn(Finding, 'findAll').mockResolvedValue([{ id: 'finding-b', taskId: 'task', evaluationId: 'evaluation-b', disposition: 'risk', status: 'escalated' }] as any);
    await expect(riskDomainService.confirm('risk', user, 1)).rejects.toMatchObject({ code: 'CONFIRM_GATE_FAILED' });
    expect(update).not.toHaveBeenCalled();
  });
});
