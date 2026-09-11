import { Op, type Transaction } from 'sequelize';
import { MemberRole, Role, TenantMember, TenantMemberStatus } from '../models';
import type { PermissionMatrix } from '../models';
import { AppError } from '../utils/http';

export function canReviewIndependentRisk(permissions: PermissionMatrix): boolean {
  return Boolean(permissions.risks?.includes('read')
    && permissions.risks?.includes('confirm')
    && permissions.remediation_actions?.includes('read')
    && (permissions.risks?.includes('verify') || permissions.remediation_actions?.includes('verify')));
}

class RiskReviewerEligibilityService {
  async eligibleMemberIds(transaction?: Transaction, memberId?: string): Promise<string[]> {
    const assignments = await MemberRole.findAll({
      ...(memberId ? { where: { memberId } } : {}), attributes: ['memberId', 'roleId'], transaction,
    });
    const roleIds = [...new Set(assignments.map((assignment) => assignment.roleId))];
    if (!roleIds.length) return [];
    const roles = await Role.findAll({ where: { id: { [Op.in]: roleIds } }, attributes: ['id', 'permissions'], transaction });
    const byId = new Map(roles.map((role) => [role.id, role.permissions]));
    const merged = new Map<string, PermissionMatrix>();
    for (const assignment of assignments) {
      const permissions = merged.get(assignment.memberId) || {};
      for (const [resource, actions] of Object.entries(byId.get(assignment.roleId) || {})) {
        const key = resource as keyof PermissionMatrix;
        permissions[key] = [...new Set([...(permissions[key] || []), ...(actions || [])])];
      }
      merged.set(assignment.memberId, permissions);
    }
    return [...merged].filter(([, permissions]) => canReviewIndependentRisk(permissions)).map(([id]) => id);
  }

  async assertEligible(userId: string | null | undefined, transaction?: Transaction): Promise<void> {
    if (!userId) throw new AppError(400, 'VALIDATION_ERROR', '人工风险必须指定审核人');
    const member = await TenantMember.findOne({ where: { userId, status: TenantMemberStatus.ACTIVE }, transaction });
    if (!member) throw new AppError(404, 'NOT_FOUND', '风险审核人不是当前租户的在职成员');
    if (!(await this.eligibleMemberIds(transaction, member.id)).includes(member.id)) {
      throw new AppError(400, 'VALIDATION_ERROR', '风险审核人必须具备风险读取、确认以及整改读取和验证权限');
    }
  }
}

export default new RiskReviewerEligibilityService();
