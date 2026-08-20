import { afterEach, describe, expect, test, vi } from 'vitest';
import { Op } from 'sequelize';
import { Department, DepartmentMember, TenantMember, User } from '../src/models';
import { AuditRule, DataSource, DataSourceStatus } from '../src/models/account';
import lookupService from '../src/services/lookup.service';
import objectAccessService from '../src/services/object-access.service';

const user: any = {
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  memberId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  permissions: { assets: ['create'] },
  permissionScopes: { assets: { create: 'all' } },
  departmentIds: [],
  isGlobalAdmin: false,
};

const finance: any = { id: '11111111-1111-4111-8111-111111111111', name: '财务部', parentId: null, status: 'active' };
const risk: any = { id: '22222222-2222-4222-8222-222222222222', name: '风险管理部', parentId: null, status: 'active' };

describe('lookup service contract', () => {
  afterEach(() => vi.restoreAllMocks());

  test('department lookup searches and returns human-readable names only', async () => {
    const findAndCount = vi.spyOn(Department, 'findAndCountAll').mockResolvedValue({ count: 1, rows: [risk] } as any);
    vi.spyOn(Department, 'findAll').mockImplementation(async (options: any) => options?.where ? [risk] : [finance, risk]);

    const result = await lookupService.list('departments', {
      purpose: 'asset-owner', q: 'RISK', page: 1, pageSize: 20,
    }, user);

    const where: any = findAndCount.mock.calls[0][0]?.where;
    expect(where.name).toBeDefined();
    expect(where.code).toBeUndefined();
    expect(result.items).toEqual([{ value: risk.id, label: '风险管理部', disabled: false }]);
    expect(JSON.stringify(result)).not.toContain('code');
  });

  test('returns pagination beyond the former 100 item cap', async () => {
    vi.spyOn(Department, 'findAndCountAll').mockResolvedValue({ count: 121, rows: [risk] } as any);
    vi.spyOn(Department, 'findAll').mockImplementation(async (options: any) => options?.where ? [risk] : [risk]);
    const result = await lookupService.list('departments', {
      purpose: 'asset-owner', page: 6, pageSize: 20,
    }, user);
    expect(result.pagination).toEqual({ page: 6, pageSize: 20, total: 121, totalPages: 7, hasMore: true });
  });

  test('rejects a purpose without the required permission', async () => {
    await expect(lookupService.list('departments', { purpose: 'product-owner' }, user))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  test('escapes wildcard characters in a literal name query', async () => {
    const findAndCount = vi.spyOn(Department, 'findAndCountAll').mockResolvedValue({ count: 0, rows: [] } as any);
    vi.spyOn(Department, 'findAll').mockResolvedValue([] as any);
    await lookupService.list('departments', { purpose: 'asset-owner', q: '100%_\\' }, user);
    const name: any = (findAndCount.mock.calls[0][0] as any).where.name;
    expect(name[Op.iLike]).toBe('%100\\%\\_\\\\%');
  });

  test('self and assigned personnel scopes only expose the current member', async () => {
    const scopedUser = { ...user, permissionScopes: { assets: { create: 'self' } } };
    const departmentLinks = vi.spyOn(DepartmentMember, 'findAll');
    const findAndCount = vi.spyOn(TenantMember, 'findAndCountAll').mockResolvedValue({ count: 0, rows: [] } as any);
    vi.spyOn(TenantMember, 'findAll').mockResolvedValue([] as any);
    vi.spyOn(User, 'findAll').mockResolvedValue([] as any);

    await lookupService.list('personnel', { purpose: 'asset-owner' }, scopedUser);

    expect(departmentLinks).not.toHaveBeenCalled();
    const where: any = findAndCount.mock.calls[0][0]?.where;
    expect(where.id[Op.in]).toEqual([user.memberId]);
  });

  test('finds personnel after the former 100 item cap', async () => {
    const person: any = {
      id: '55555555-5555-4555-8555-555555555555', userId: '66666666-6666-4666-8666-666666666666',
      displayName: '第一百零一个成员', status: 'active',
    };
    const findAndCount = vi.spyOn(TenantMember, 'findAndCountAll').mockResolvedValue({ count: 121, rows: [person] } as any);
    vi.spyOn(TenantMember, 'findAll').mockResolvedValue([] as any);
    vi.spyOn(User, 'findAll').mockResolvedValue([{ id: person.userId, username: 'member_101' }] as any);

    const result = await lookupService.list('personnel', {
      purpose: 'asset-owner', q: '第一百零一', page: 6, pageSize: 20,
    }, user);

    expect(findAndCount).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, offset: 100 }));
    expect(result.items[0]).toMatchObject({ value: person.userId, label: person.displayName, disabled: false });
    expect(result.pagination.total).toBe(121);
  });

  test('does not hydrate a selected department outside the operator scope', async () => {
    const scopedUser = { ...user, permissionScopes: { assets: { create: 'department' } }, departmentIds: [finance.id] };
    vi.spyOn(Department, 'findAndCountAll').mockResolvedValue({ count: 0, rows: [] } as any);
    const findAll = vi.spyOn(Department, 'findAll').mockImplementation(async (options: any) => options?.attributes?.includes('status') ? [] : [finance, risk]);

    const result = await lookupService.list('departments', {
      purpose: 'asset-owner', selectedIds: risk.id,
    }, scopedUser);

    expect(result.selectedItems).toEqual([]);
    const selectedQuery: any = findAll.mock.calls.find(([options]: any[]) => options?.attributes?.includes('status'))?.[0];
    expect(selectedQuery.where.id[Op.in]).toEqual([]);
  });

  test('rejects a forged context before returning selected records', async () => {
    vi.spyOn(objectAccessService, 'assetOrNotFound').mockRejectedValue(Object.assign(new Error('not found'), {
      statusCode: 404, code: 'NOT_FOUND',
    }));
    const findAndCount = vi.spyOn(Department, 'findAndCountAll');

    await expect(lookupService.list('departments', {
      purpose: 'asset-owner', contextId: '44444444-4444-4444-8444-444444444444', selectedIds: risk.id,
    }, user)).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(findAndCount).not.toHaveBeenCalled();
  });

  test('hydrates an out-of-scope historical owner only through its accessible context and disables it', async () => {
    const scopedUser = { ...user, permissionScopes: { assets: { update: 'department' } }, permissions: { assets: ['update'] }, departmentIds: [finance.id] };
    vi.spyOn(objectAccessService, 'assetOrNotFound').mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444', ownerDepartmentId: risk.id, ownerUserId: null,
    } as any);
    vi.spyOn(Department, 'findAndCountAll').mockResolvedValue({ count: 0, rows: [] } as any);
    vi.spyOn(Department, 'findAll').mockImplementation(async (options: any) => {
      if (!options?.where) return [finance, risk];
      const ids = options.where.id?.[Op.in] || [];
      return ids.includes(risk.id) ? [risk] : [];
    });

    const result = await lookupService.list('departments', {
      purpose: 'asset-owner', contextId: '44444444-4444-4444-8444-444444444444', selectedIds: risk.id,
    }, scopedUser);

    expect(result.selectedItems).toEqual([{ value: risk.id, label: '风险管理部', disabled: true }]);
  });

  test('finds data sources after the former first-page cap without returning connection details', async () => {
    const source: any = {
      id: '33333333-3333-4333-8333-333333333333', name: '第二十一数据源', sourceType: 'DATABASE',
      status: DataSourceStatus.ACTIVE, connectionConfig: { host: 'secret-host', username: 'secret-user' },
    };
    const findAndCount = vi.spyOn(DataSource, 'findAndCountAll').mockResolvedValue({ count: 21, rows: [source] } as any);
    vi.spyOn(DataSource, 'findAll').mockResolvedValue([] as any);
    const accountUser = {
      ...user,
      permissions: { account_tasks: ['create'] },
      permissionScopes: { account_tasks: { create: 'all' } },
    };

    const result = await lookupService.list('account-data-sources', {
      purpose: 'account-task-source', q: '第二十一', page: 2, pageSize: 20,
    }, accountUser);

    expect((findAndCount.mock.calls[0][0] as any).where.name[Op.iLike]).toBe('%第二十一%');
    expect(result.pagination).toEqual({ page: 2, pageSize: 20, total: 21, totalPages: 2, hasMore: false });
    expect(result.items[0]).toEqual({
      value: source.id, label: source.name, disabled: false,
      meta: { sourceType: 'DATABASE', status: DataSourceStatus.ACTIVE },
    });
    expect(JSON.stringify(result)).not.toContain('secret-host');
    expect(JSON.stringify(result)).not.toContain('secret-user');
  });

  test('finds rules after the former 20 item cap by human-readable name', async () => {
    const rule: any = {
      id: '77777777-7777-4777-8777-777777777777', name: '第二十一条规则', isActive: true,
      severity: 'HIGH', ruleType: 'CUSTOM', builtinKey: 'SHOULD_NOT_BE_EXPOSED',
    };
    vi.spyOn(AuditRule, 'findAndCountAll').mockResolvedValue({ count: 21, rows: [rule] } as any);
    vi.spyOn(AuditRule, 'findAll').mockResolvedValue([] as any);
    const accountUser = {
      ...user,
      permissions: { account_tasks: ['create'] },
      permissionScopes: { account_tasks: { create: 'all' } },
    };

    const result = await lookupService.list('account-rules', {
      purpose: 'account-task-rules', q: '第二十一', page: 2, pageSize: 20,
    }, accountUser);

    expect(result.items[0]).toEqual({
      value: rule.id, label: rule.name, disabled: false,
      meta: { severity: 'HIGH', ruleType: 'CUSTOM' },
    });
    expect(JSON.stringify(result)).not.toContain('SHOULD_NOT_BE_EXPOSED');
  });
});
