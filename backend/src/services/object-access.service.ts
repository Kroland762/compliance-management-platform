import { Op, type WhereOptions } from 'sequelize';
import { AuditTask, Department, Qualification, QuestionItem, RiskRecord } from '../models';
import type { DataScope, PermissionResource } from '../models';
import { AppError } from '../utils/http';

type RequestUser = NonNullable<Express.Request['user']>;

class ObjectAccessService {
  private scope(user: RequestUser, resource: PermissionResource, action: string): DataScope {
    if (user.isGlobalAdmin) return 'all';
    return user.permissionScopes?.[resource]?.[action] || 'self';
  }

  private async departmentTreeIds(seedIds: string[]): Promise<string[]> {
    const result = new Set(seedIds);
    let frontier = [...seedIds];
    while (frontier.length > 0) {
      const children = await Department.findAll({
        // Archived departments remain part of the historical ownership tree so
        // moving personnel does not silently hide old tasks and qualifications.
        where: { parentId: { [Op.in]: frontier } },
        attributes: ['id'],
      });
      frontier = children.map((child) => child.id).filter((id) => !result.has(id));
      frontier.forEach((id) => result.add(id));
    }
    return [...result];
  }

  private async departmentIds(user: RequestUser, scope: DataScope): Promise<string[]> {
    if (scope === 'department') return user.departmentIds || [];
    if (scope === 'department_tree') return this.departmentTreeIds(user.departmentIds || []);
    return [];
  }

  canReadAllTasks(user: RequestUser): boolean {
    return this.scope(user, 'tasks', 'read') === 'all';
  }

  async taskScope(user: RequestUser, action = 'read', onlyAssignedQuestions = false): Promise<WhereOptions> {
    const scope = this.scope(user, 'tasks', action);
    const assigned = await QuestionItem.findAll({
      where: { assignedTo: user.userId },
      attributes: ['taskId'],
      group: ['taskId'],
      raw: true,
    });
    const assignedIds = assigned.map((row: any) => row.taskId);
    if (onlyAssignedQuestions || scope === 'assigned') {
      return {
        [Op.or]: [
          { assignedTo: user.userId },
          { reviewerId: user.userId },
          { id: { [Op.in]: assignedIds } },
        ],
      };
    }
    if (scope === 'all') return {};
    if (scope === 'department' || scope === 'department_tree') {
      return { departmentId: { [Op.in]: await this.departmentIds(user, scope) } };
    }
    return {
      [Op.or]: [
        { createdBy: user.userId },
        { assignedTo: user.userId },
        { reviewerId: user.userId },
      ],
    };
  }

  async taskOrNotFound(id: string, user: RequestUser, action = 'read'): Promise<AuditTask> {
    const scope = await this.taskScope(user, action);
    const task = await AuditTask.findOne({ where: { id, ...(scope as object) } });
    if (!task) throw new AppError(404, 'NOT_FOUND', '任务不存在');
    return task;
  }

  async accessibleTaskIds(user: RequestUser): Promise<string[] | null> {
    if (this.canReadAllTasks(user)) return null;
    const rows = await AuditTask.findAll({
      where: await this.taskScope(user),
      attributes: ['id'],
      raw: true,
    });
    return rows.map((row: any) => row.id);
  }

  async qualificationScope(user: RequestUser, action = 'read'): Promise<WhereOptions> {
    const scope = this.scope(user, 'qualifications', action);
    if (scope === 'all') return {};
    if (scope === 'department' || scope === 'department_tree') {
      return { ownerDepartmentId: { [Op.in]: await this.departmentIds(user, scope) } };
    }
    if (scope === 'assigned') return { responsibleUserId: user.userId };
    return { [Op.or]: [{ createdBy: user.userId }, { responsibleUserId: user.userId }] };
  }

  async qualificationOrNotFound(id: string, user: RequestUser, action = 'read'): Promise<Qualification> {
    const qualification = await Qualification.findOne({
      where: { id, ...(await this.qualificationScope(user, action) as object) },
    });
    if (!qualification) throw new AppError(404, 'NOT_FOUND', '资质记录不存在');
    return qualification;
  }

  async auditScope(user: RequestUser, action = 'read'): Promise<WhereOptions> {
    const scope = this.scope(user, 'audit_logs', action);
    if (scope === 'all') return {};
    if (scope === 'department' || scope === 'department_tree') {
      return {
        departmentId: {
          [Op.ne]: null,
          [Op.in]: await this.departmentIds(user, scope),
        },
      };
    }
    return { userId: user.userId };
  }

  async riskOrNotFound(id: string, user: RequestUser, action = 'read'): Promise<RiskRecord> {
    const risk = await RiskRecord.findByPk(id);
    if (!risk || !risk.taskId) throw new AppError(404, 'NOT_FOUND', '风险记录不存在');
    await this.taskOrNotFound(risk.taskId, user, action);
    return risk;
  }

  async questionOrNotFound(id: string, user: RequestUser, write = false): Promise<QuestionItem> {
    const item = await QuestionItem.findByPk(id);
    if (!item) throw new AppError(404, 'NOT_FOUND', '问卷条目不存在');
    const task = await this.taskOrNotFound(item.taskId, user, write ? 'update' : 'read');
    const scope = this.scope(user, 'tasks', write ? 'update' : 'read');
    if (['all', 'department', 'department_tree'].includes(scope)) return item;
    const related = item.assignedTo === user.userId
      || task.createdBy === user.userId
      || task.reviewerId === user.userId
      || task.assignedTo === user.userId;
    if (!related) throw new AppError(404, 'NOT_FOUND', '问卷条目不存在');
    return item;
  }
}

export default new ObjectAccessService();
