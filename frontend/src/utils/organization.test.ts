import { describe, expect, it } from 'vitest';
import { expandDepartment, reconcileExpandedDepartmentIds } from './organization';

const departments = [{
  id: 'root',
  children: [{ id: 'security', children: [{ id: 'audit' }] }],
}];

describe('organization tree expansion', () => {
  it('only expands top-level roots on first load', () => {
    expect(reconcileExpandedDepartmentIds(departments, null)).toEqual(['root']);
  });

  it('preserves the current expansion and removes missing departments on refresh', () => {
    expect(reconcileExpandedDepartmentIds(departments, ['root', 'security', 'deleted']))
      .toEqual(['root', 'security']);
  });

  it('expands a parent once without duplicating it', () => {
    expect(expandDepartment(['root'], 'security')).toEqual(['root', 'security']);
    expect(expandDepartment(['root', 'security'], 'security')).toEqual(['root', 'security']);
  });
});
