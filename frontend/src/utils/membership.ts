export interface DepartmentAssignment {
  departmentId: string;
  isPrimary: boolean;
}

export function buildDepartmentAssignments(
  departmentIds: string[],
  primaryDepartmentId: string,
): DepartmentAssignment[] {
  const uniqueIds = Array.from(new Set(departmentIds));
  if (!primaryDepartmentId || !uniqueIds.includes(primaryDepartmentId)) {
    throw new Error('主部门必须包含在成员部门中');
  }
  return uniqueIds.map((departmentId) => ({
    departmentId,
    isPrimary: departmentId === primaryDepartmentId,
  }));
}

export function buildPermissionConfiguration(
  resources: string[],
  values: Record<string, unknown>,
): {
  permissions: Record<string, string[]>;
  permissionScopes: Record<string, Record<string, string>>;
} {
  const permissions: Record<string, string[]> = {};
  const permissionScopes: Record<string, Record<string, string>> = {};
  for (const resource of resources) {
    const actions = (values[`perm_${resource}`] || []) as string[];
    if (actions.length === 0) continue;
    permissions[resource] = actions;
    permissionScopes[resource] = Object.fromEntries(actions.map((action) => [
      action,
      String(values[`scope_${resource}_${action}`] || 'self'),
    ]));
  }
  return { permissions, permissionScopes };
}
