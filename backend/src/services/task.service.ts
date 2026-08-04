import { Op } from 'sequelize';
import {
  AuditTask,
  QuestionnaireTemplate,
  QuestionTemplate,
  QuestionItem,
  User,
  TaskStatus,
  AnswerStatus,
  OperationType,
  UserRole,
} from '../models';
import auditLogService from './audit-log.service';

interface CreateTaskInput {
  templateId: string;
  assessmentType: string;
  assessmentTarget: string;
  assignedTo?: string | null;
  reviewerId?: string | null;
  createdBy: string;
  tenantId?: string;
}

interface TaskQuery {
  page?: number;
  pageSize?: number;
  status?: TaskStatus;
  assessmentType?: string;
  userId?: string;
  userRole?: UserRole;
  my?: string;
  tenantWideScope?: boolean;
}

class TaskService {

  // ============ CRUD ============

  async createTask(input: CreateTaskInput): Promise<AuditTask> {
    const template = await QuestionnaireTemplate.findByPk(input.templateId, {
      include: [{ association: 'templateQuestions' }],
    });
    if (!template) throw new Error('模板不存在');

    if (input.assignedTo) {
      const assignee = await User.findByPk(input.assignedTo);
      if (!assignee) throw new Error('被指派的用户不存在');
      if ((assignee.tenantId || undefined) !== input.tenantId) throw new Error('不能指派其他租户的用户');
    }
    if (input.reviewerId) {
      const reviewer = await User.findByPk(input.reviewerId);
      if (!reviewer || (reviewer.tenantId || undefined) !== input.tenantId) throw new Error('复核人不存在或不属于当前租户');
    }

    const task = await AuditTask.create({
      templateId: input.templateId,
      assessmentType: input.assessmentType as any,
      assessmentTarget: input.assessmentTarget,
      createdBy: input.createdBy,
      assignedTo: input.assignedTo || null,
      reviewerId: input.reviewerId || input.createdBy,
      status: TaskStatus.DRAFT,
    } as any);

    const templateQuestions = (template as any).templateQuestions as QuestionTemplate[];
    const questionItems = templateQuestions.map(q => ({
      taskId: task.id,
      templateQuestionId: q.id,
      sequenceNumber: q.sequenceNumber,
      controlDomain: q.controlDomain,
      controlPoint: q.controlPoint,
      referenceAnswer: q.referenceAnswer,
      historicalEvidencePath: q.historicalEvidencePath,
      responsibleDepartment: q.responsibleDepartment,
      responsiblePerson: q.responsiblePerson,
      answerStatus: AnswerStatus.PENDING,
    }));

    await QuestionItem.bulkCreate(questionItems as any);

    await auditLogService.log({
      userId: input.createdBy,
      operationType: OperationType.CREATE,
      resourceType: 'task',
      resourceId: task.id,
      operationDetails: `创建审计任务，目标: ${input.assessmentTarget}`,
      success: true,
    });

    return task;
  }

  async getTaskById(id: string) {
    const task = await AuditTask.findByPk(id, {
      include: [
        { association: 'template', attributes: ['id', 'name', 'description'] },
        { association: 'creator', attributes: ['id', 'username', 'department'] },
        { association: 'assignee', attributes: ['id', 'username', 'department'] },
        { association: 'reviewer', attributes: ['id', 'username', 'department'] },
      ],
    });
    if (!task) throw new Error('任务不存在');
    return task;
  }

  // ============ 查询（带过滤 + 统计）============

  private async getTasks(query: TaskQuery) {
    const { page = 1, pageSize = 20, status, assessmentType, userId } = query;
    const where: any = {};

    if (userId && !query.tenantWideScope) {
      if (query.my === 'true') {
        // 「我的任务」：只看有题目分给自己的任务
        const assignedTaskIds = await QuestionItem.findAll({
          where: { assignedTo: userId },
          attributes: [['taskId', 'taskId']],
          group: ['taskId'],
          raw: true,
        });
        const ids = assignedTaskIds.map((r: any) => r.taskId);
        if (ids.length > 0) {
          where.id = { [Op.in]: ids };
        } else {
          where.id = { [Op.in]: [] }; // 无匹配任务
        }
        where.status = { [Op.ne]: TaskStatus.DRAFT };
      } else {
        const assignedTaskIds = await QuestionItem.findAll({
          where: { assignedTo: userId },
          attributes: [['taskId', 'taskId']],
          group: ['taskId'],
          raw: true,
        });
        const ids = assignedTaskIds.map((r: any) => r.taskId);
        where[Op.or] = [
          { createdBy: userId },
          { assignedTo: userId },
          { reviewerId: userId },
          { id: { [Op.in]: ids } },
        ];
      }
    }

    if (status) where.status = status;
    if (assessmentType) where.assessmentType = assessmentType;

    const { count, rows } = await AuditTask.findAndCountAll({
      where,
      include: [
        { association: 'template', attributes: ['id', 'name'] },
        { association: 'creator', attributes: ['id', 'username', 'department'] },
        { association: 'assignee', attributes: ['id', 'username', 'department'] },
        { association: 'reviewer', attributes: ['id', 'username', 'department'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      distinct: true,
    });

    return {
      items: rows,
      pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
    };
  }

  async getTasksWithStats(query: TaskQuery) {
    const result = await this.getTasks(query);
    if (!result.items.length) return result;

    const taskIds = result.items.map((t: any) => t.id);
    
    // 聚合每个任务的所有普通用户
    const assigneeRows = await QuestionItem.sequelize!.query(
      `SELECT DISTINCT qi."taskId", u.username FROM question_items qi LEFT JOIN users u ON u.id = qi."assignedTo" WHERE qi."taskId" IN (:taskIds) AND qi."assignedTo" IS NOT NULL`,
      { replacements: { taskIds }, type: 'SELECT' }
    ) as any[];
    const assigneesMap: Record<string, string[]> = {};
    assigneeRows.forEach((r: any) => {
      if (!assigneesMap[r.taskId]) assigneesMap[r.taskId] = [];
      assigneesMap[r.taskId].push(r.username);
    });

    const stats = await QuestionItem.findAll({
      where: { taskId: { [Op.in]: taskIds } },
      attributes: [
        ['taskId', 'taskId'],
        [QuestionItem.sequelize!.fn('COUNT', QuestionItem.sequelize!.col('id')), 'total'],
      ],
      group: ['taskId'],
      raw: true,
    });

    const answered = await QuestionItem.findAll({
      where: { taskId: { [Op.in]: taskIds }, answerStatus: AnswerStatus.ANSWERED },
      attributes: [
        ['taskId', 'taskId'],
        [QuestionItem.sequelize!.fn('COUNT', QuestionItem.sequelize!.col('id')), 'answered'],
      ],
      group: ['taskId'],
      raw: true,
    });

    const statsMap: Record<string, any> = {};
    stats.forEach((s: any) => { statsMap[s.taskId] = { total: Number(s.total), answered: 0 }; });
    answered.forEach((a: any) => {
      if (statsMap[a.taskId]) statsMap[a.taskId].answered = Number(a.answered);
    });

    result.items = result.items.map((r: any) => {
      const json = r.toJSON ? r.toJSON() : r;
      json._stats = statsMap[r.id] || { total: 0, answered: 0 };
      json._assignees = assigneesMap[r.id] || [];
      return json;
    });

    // 按当前用户维度的统计（「我的任务」用）
    if (query.my === 'true' && query.userId) {
      const myStats = await QuestionItem.findAll({
        where: { taskId: { [Op.in]: taskIds }, assignedTo: query.userId },
        attributes: [
          ['taskId', 'taskId'],
          [QuestionItem.sequelize!.fn('COUNT', QuestionItem.sequelize!.col('id')), 'myTotal'],
        ],
        group: ['taskId'],
        raw: true,
      });
      const myAnswered = await QuestionItem.findAll({
        where: { taskId: { [Op.in]: taskIds }, assignedTo: query.userId, answerStatus: AnswerStatus.ANSWERED },
        attributes: [
          ['taskId', 'taskId'],
          [QuestionItem.sequelize!.fn('COUNT', QuestionItem.sequelize!.col('id')), 'myAnswered'],
        ],
        group: ['taskId'],
        raw: true,
      });
      const myMap: Record<string, any> = {};
      myStats.forEach((s: any) => { myMap[s.taskId] = { myTotal: Number(s.myTotal), myAnswered: 0 }; });
      myAnswered.forEach((a: any) => { if (myMap[a.taskId]) myMap[a.taskId].myAnswered = Number(a.myAnswered); });
      result.items.forEach((r: any) => {
        r._myStats = myMap[r.id] || { myTotal: 0, myAnswered: 0 };
      });
    }

    return result;
  }
}

export default new TaskService();
