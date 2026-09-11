import { afterEach, describe, expect, test, vi } from 'vitest';
import { DepartmentMember, MemberRole, Role, TenantMember } from '../src/models';
import memberContextService from '../src/services/member-context.service';

describe('member context department identity', () => {
  afterEach(() => vi.restoreAllMocks());

  test('returns the primary department name together with its stable id', async () => {
    vi.spyOn(TenantMember, 'findOne').mockResolvedValue({ id: 'member-1', status: 'active' });
    vi.spyOn(MemberRole, 'findAll').mockResolvedValue([{ roleId: 'role-1' }]);
    vi.spyOn(Role, 'findAll').mockResolvedValue([{
      id: 'role-1',
      name: '审计员',
      permissions: { tasks: ['read'] },
      permissionScopes: { tasks: { read: 'assigned' } },
    }]);
    vi.spyOn(DepartmentMember, 'findAll').mockResolvedValue([{
      departmentId: 'department-1',
      isPrimary: true,
      department: { id: 'department-1', name: '安全合规部' },
    }]);

    await expect(memberContextService.resolve('user-1')).resolves.toMatchObject({
      primaryDepartmentId: 'department-1',
      primaryDepartmentName: '安全合规部',
      departmentIds: ['department-1'],
    });
  });
});
