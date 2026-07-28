import { Op } from 'sequelize';
import { DepartmentMember, MemberRole, Role, TenantMember, TenantMemberStatus } from '../models';
import type { DataScope, PermissionMatrix, PermissionScopeMatrix } from '../models';
import { AppError } from '../utils/http';

const SCOPE_RANK: Record<DataScope, number> = {
  self: 1,
  assigned: 2,
  department: 3,
  department_tree: 4,
  all: 5,
};

export interface ResolvedMemberContext {
  member: TenantMember;
  roleIds: string[];
  roleNames: string[];
  permissions: PermissionMatrix;
  permissionScopes: PermissionScopeMatrix;
  departmentIds: string[];
  primaryDepartmentId: string;
}

class MemberContextService {
  async resolve(userId: string, required = true): Promise<ResolvedMemberContext | null> {
    const member = await TenantMember.findOne({ where: { userId } });
    if (!member || member.status !== TenantMemberStatus.ACTIVE) {
      if (required) throw new AppError(403, 'MEMBERSHIP_INACTIVE', '当前租户成员身份不存在或已停用');
      return null;
    }

    const assignments = await MemberRole.findAll({ where: { memberId: member.id } });
    const roleIds = assignments.map((assignment) => assignment.roleId);
    const roles = roleIds.length > 0
      ? await Role.findAll({ where: { id: { [Op.in]: roleIds } } })
      : [];
    if (roles.length !== roleIds.length) {
      throw new AppError(403, 'INVALID_MEMBERSHIP_ROLE', '成员角色配置无效');
    }

    const permissions: PermissionMatrix = {};
    const permissionScopes: PermissionScopeMatrix = {};
    for (const role of roles) {
      for (const [resource, actions] of Object.entries(role.permissions || {})) {
        const targetActions = permissions[resource as keyof PermissionMatrix] || [];
        for (const action of actions || []) {
          if (!targetActions.includes(action)) targetActions.push(action);
          const candidate = role.permissionScopes?.[resource as keyof PermissionScopeMatrix]?.[action] || 'all';
          const current = permissionScopes[resource as keyof PermissionScopeMatrix]?.[action];
          if (!current || SCOPE_RANK[candidate] > SCOPE_RANK[current]) {
            permissionScopes[resource as keyof PermissionScopeMatrix] = {
              ...(permissionScopes[resource as keyof PermissionScopeMatrix] || {}),
              [action]: candidate,
            };
          }
        }
        permissions[resource as keyof PermissionMatrix] = targetActions;
      }
    }

    const departments = await DepartmentMember.findAll({ where: { memberId: member.id } });
    const primary = departments.find((assignment) => assignment.isPrimary);
    if (!primary) throw new AppError(403, 'PRIMARY_DEPARTMENT_REQUIRED', '成员未配置主部门');

    return {
      member,
      roleIds,
      roleNames: roles.map((role) => role.name),
      permissions,
      permissionScopes,
      departmentIds: departments.map((assignment) => assignment.departmentId),
      primaryDepartmentId: primary.departmentId,
    };
  }

  scopeFor(context: ResolvedMemberContext, resource: keyof PermissionScopeMatrix, action: string): DataScope {
    return context.permissionScopes[resource]?.[action] || 'self';
  }
}

export default new MemberContextService();
