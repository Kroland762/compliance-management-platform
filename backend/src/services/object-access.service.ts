import { Op, type WhereOptions } from 'sequelize';
import { AuditTask, QuestionItem, RiskRecord } from '../models';
import { AppError } from '../utils/http';

type RequestUser = NonNullable<Express.Request['user']>;

function has(user: RequestUser, resource: string, action: string): boolean {
  const permissions = user.permissions as Record<string, string[] | undefined>;
  return permissions[resource]?.includes(action) === true;
}

class ObjectAccessService {
  canReadAllTasks(user: RequestUser): boolean {
    return has(user, 'tasks', 'delete') || (has(user, 'users', 'read') && has(user, 'tasks', 'read'));
  }

  async taskScope(user: RequestUser, onlyAssignedQuestions = false): Promise<WhereOptions> {
    const assigned = await QuestionItem.findAll({
      where: { assignedTo: user.userId },
      attributes: ['taskId'],
      group: ['taskId'],
      raw: true,
    });
    const assignedIds = assigned.map((row: any) => row.taskId);
    if (onlyAssignedQuestions) return { id: { [Op.in]: assignedIds } };
    if (this.canReadAllTasks(user)) return {};
    return {
      [Op.or]: [
        { createdBy: user.userId },
        { assignedTo: user.userId },
        { reviewerId: user.userId },
        { id: { [Op.in]: assignedIds } },
      ],
    };
  }

  async taskOrNotFound(id: string, user: RequestUser): Promise<AuditTask> {
    const scope = await this.taskScope(user);
    const task = await AuditTask.findOne({ where: { id, ...(scope as object) } });
    if (!task) throw new AppError(404, 'NOT_FOUND', '任务不存在');
    return task;
  }

  async accessibleTaskIds(user: RequestUser): Promise<string[] | null> {
    if (this.canReadAllTasks(user)) return null;
    const where = await this.taskScope(user);
    const rows = await AuditTask.findAll({ where, attributes: ['id'], raw: true });
    return rows.map((row: any) => row.id);
  }

  async riskOrNotFound(id: string, user: RequestUser): Promise<RiskRecord> {
    const risk = await RiskRecord.findByPk(id);
    if (!risk) throw new AppError(404, 'NOT_FOUND', '风险记录不存在');
    if (this.canReadAllTasks(user)) return risk;
    if (!risk.taskId) throw new AppError(404, 'NOT_FOUND', '风险记录不存在');
    await this.taskOrNotFound(risk.taskId, user);
    return risk;
  }

  async questionOrNotFound(id: string, user: RequestUser, write = false): Promise<QuestionItem> {
    const item = await QuestionItem.findByPk(id);
    if (!item) throw new AppError(404, 'NOT_FOUND', '问卷条目不存在');
    if (this.canReadAllTasks(user)) return item;
    const task = await this.taskOrNotFound(item.taskId, user);
    const related = item.assignedTo === user.userId
      || task.createdBy === user.userId
      || task.reviewerId === user.userId
      || task.assignedTo === user.userId;
    if (!related || (write && item.assignedTo !== user.userId && task.createdBy !== user.userId && task.reviewerId !== user.userId)) {
      throw new AppError(404, 'NOT_FOUND', '问卷条目不存在');
    }
    return item;
  }
}

export default new ObjectAccessService();
