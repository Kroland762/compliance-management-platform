interface DepartmentTreeNode {
  id: string;
  children?: DepartmentTreeNode[];
}

function collectDepartmentIds(items: DepartmentTreeNode[]): string[] {
  return items.flatMap((item) => [item.id, ...collectDepartmentIds(item.children || [])]);
}

export function reconcileExpandedDepartmentIds(
  departments: DepartmentTreeNode[],
  expandedDepartmentIds: string[] | null,
): string[] {
  if (expandedDepartmentIds === null) return departments.map((department) => department.id);
  const validIds = new Set(collectDepartmentIds(departments));
  return expandedDepartmentIds.filter((id) => validIds.has(id));
}

export function expandDepartment(
  expandedDepartmentIds: string[] | null,
  departmentId: string | null,
): string[] | null {
  if (!departmentId) return expandedDepartmentIds;
  return Array.from(new Set([...(expandedDepartmentIds || []), departmentId]));
}
