import { describe, expect, it } from 'vitest';
import {
  buildDepartmentAssignments,
  buildPermissionConfiguration,
  resolvePrimaryDepartmentId,
} from './membership';

describe('membership form contracts', () => {
  it('creates exactly one primary department and de-duplicates兼职部门', () => {
    expect(buildDepartmentAssignments(['root', 'security', 'security'], 'security')).toEqual([
      { departmentId: 'root', isPrimary: false },
      { departmentId: 'security', isPrimary: true },
    ]);
  });

  it('rejects a primary department outside the member department selection', () => {
    expect(() => buildDepartmentAssignments(['root'], 'security')).toThrow('主部门');
  });

  it('automatically uses the only selected department as primary', () => {
    expect(resolvePrimaryDepartmentId(['security'])).toBe('security');
  });

  it('clears a primary department removed from the member department selection', () => {
    expect(resolvePrimaryDepartmentId(['root', 'finance'], 'security')).toBeUndefined();
  });

  it('keeps a valid primary department when multiple departments are selected', () => {
    expect(resolvePrimaryDepartmentId(['root', 'security'], 'security')).toBe('security');
  });

  it('builds resource, action and data-scope matrices together', () => {
    expect(buildPermissionConfiguration(['tasks'], {
      perm_tasks: ['read', 'update'],
      scope_tasks_read: 'department_tree',
      scope_tasks_update: 'assigned',
    })).toEqual({
      permissions: { tasks: ['read', 'update'] },
      permissionScopes: { tasks: { read: 'department_tree', update: 'assigned' } },
    });
  });
});
