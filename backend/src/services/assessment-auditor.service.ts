import { Op } from 'sequelize';
import sequelize from '../config/database';
import {
  AssessmentAuditor,
  AuditTask,
  EvaluationWorkflowStatus,
  MemberRole,
  OperationType,
  QuestionItem,
  Role,
  TaskStatus,
  TenantMember,
  TenantMemberStatus,
} from '../models';
import { AppError } from '../utils/http';
import auditLogService from './audit-log.service';
import objectAccessService from './object-access.service';
import lookupService from './lookup.service';

type RequestUser = NonNullable<Express.Request['user']>;

class AssessmentAuditorService {
  async list(taskId: string) {
    return AssessmentAuditor.findAll({
      where: { taskId },
      include: [{ association: 'auditor', attributes: ['id', 'username', 'email'] }],
      order: [['assignedAt', 'ASC']],
    });
  }

  async replace(taskId: string, userIds: string[], user: RequestUser) {
    await objectAccessService.taskOrNotFound(taskId, user, 'update');
    const task = await AuditTask.findByPk(taskId);
    if (!task) throw new AppError(404, 'NOT_FOUND', '评估项目不存在');
    if ([TaskStatus.CLOSED, TaskStatus.CANCELLED].includes(task.status)) {
      throw new AppError(409, 'CONFLICT', '已关闭或已取消的评估不能调整审计员');
    }
    const uniqueIds = [...new Set((userIds || []).filter(Boolean))];
    await lookupService.assertSelectable('auditors', 'assessment-owner', uniqueIds, user);
    const members = uniqueIds.length
      ? await TenantMember.findAll({ where: { userId: { [Op.in]: uniqueIds }, status: TenantMemberStatus.ACTIVE } })
      : [];
    if (members.length !== uniqueIds.length) throw new AppError(404, 'NOT_FOUND', '包含无效或已停用的审计员');
    if (members.length) {
      const memberIds = members.map((member) => member.id);
      const assignments = await MemberRole.findAll({ where: { memberId: { [Op.in]: memberIds } } });
      const roles = assignments.length
        ? await Role.findAll({ where: { id: { [Op.in]: assignments.map((item) => item.roleId) } } })
        : [];
      const roleMap = new Map(roles.map((role) => [role.id, role]));
      const canReview = new Set(assignments.filter((assignment) =>
        roleMap.get(assignment.roleId)?.permissions?.evaluations?.includes('review'))
        .map((assignment) => assignment.memberId));
      if (members.some((member) => !canReview.has(member.id))) {
        throw new AppError(400, 'INVALID_AUDITOR', '被分配成员缺少评估复核权限');
      }
    }

    await sequelize.transaction(async (transaction) => {
      const before = await AssessmentAuditor.findAll({ where: { taskId }, transaction, lock: transaction.LOCK.UPDATE });
      const removed = before.map((item) => item.auditorUserId).filter((id) => !uniqueIds.includes(id));
      if (removed.length) {
        await QuestionItem.update(
          { reviewClaimedBy: null, reviewClaimedAt: null },
          {
            where: {
              taskId,
              reviewClaimedBy: { [Op.in]: removed },
              workflowStatus: EvaluationWorkflowStatus.SUBMITTED,
            },
            transaction,
          },
        );
      }
      await AssessmentAuditor.destroy({ where: { taskId }, transaction });
      if (uniqueIds.length) {
        await AssessmentAuditor.bulkCreate(uniqueIds.map((auditorUserId) => ({
          taskId,
          auditorUserId,
          assignedBy: user.userId,
        })), { transaction });
      }
    });
    await auditLogService.log({
      userId: user.userId,
      operationType: OperationType.UPDATE,
      resourceType: 'assessment_auditors',
      resourceId: taskId,
      operationDetails: `配置评估审计员，共 ${uniqueIds.length} 人`,
      success: true,
      departmentId: task.departmentId,
    });
    return this.list(taskId);
  }

  async assignedTaskIds(userId: string): Promise<string[]> {
    const rows = await AssessmentAuditor.findAll({ where: { auditorUserId: userId }, attributes: ['taskId'], raw: true });
    return rows.map((row: any) => row.taskId);
  }
}

export default new AssessmentAuditorService();
