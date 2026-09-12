import { Op } from 'sequelize';
import {
  AuditTask,
  QuestionnaireTemplate,
  QuestionItem,
  TenantMember,
  TenantMemberStatus,
  Department,
  TaskStatus,
  EvaluationWorkflowStatus,
  OperationType,
  Finding,
} from '../models';
import auditLogService from './audit-log.service';
import objectAccessService from './object-access.service';
import { pagination, parsePagination } from '../utils/pagination';
import { normalizeEvaluationColumnSchema } from '../utils/evaluation-columns';
import { AppError } from '../utils/http';
import lookupService from './lookup.service';

type RequestUser = NonNullable<Express.Request['user']>;

interface CreateTaskInput {
  templateId: string;
  assessmentType: string;
  name?: string;
  assessmentTarget: string;
  assignedTo?: string | null;
  reviewerId?: string | null;
  departmentId: string;
  createdBy: string;
  periodStart?: Date | null;
  periodEnd?: Date | null;
}

interface TaskQuery {
  page?: number;
  pageSize?: number;
  status?: TaskStatus;
  assessmentType?: string;
  userId?: string;
  user?: NonNullable<Express.Request['user']>;
  my?: string;
}

class TaskService {

  // ============ CRUD ============

  async createTask(input: CreateTaskInput, user?: RequestUser): Promise<AuditTask> {
    const template = await QuestionnaireTemplate.findByPk(input.templateId, {
      include: [{ association: 'templateQuestions' }],
    });
    if (!template) throw new Error('模板不存在');

    if (user) {
      await lookupService.assertSelectable('assessment-templates', 'assessment-owner', [input.templateId], user);
      await lookupService.assertOwners('assessment-owner', input.departmentId, input.assignedTo, user);
    }

    if (input.assignedTo) {
      const assignee = await TenantMember.findOne({
        where: { userId: input.assignedTo, status: TenantMemberStatus.ACTIVE },
      });
      if (!assignee) throw new Error('被指派的用户不存在或不属于当前租户');
    }
    if (input.reviewerId && !await TenantMember.findOne({
      where: { userId: input.reviewerId, status: TenantMemberStatus.ACTIVE },
    })) throw new Error('审阅人不存在或不属于当前租户');
    if (!await Department.findOne({ where: { id: input.departmentId, status: 'active' } })) {
      throw new Error('归属部门不存在或已归档');
    }

    const taskName = input.name?.trim() || input.assessmentTarget?.trim();
    if (!taskName) throw new Error('评估名称不能为空');
    const task = await AuditTask.create({
      name: taskName,
      templateId: input.templateId,
      assessmentType: input.assessmentType as any,
      assessmentTarget: input.assessmentTarget,
      createdBy: input.createdBy,
      assignedTo: input.assignedTo || null,
      reviewerId: input.reviewerId || null,
      departmentId: input.departmentId,
      status: TaskStatus.PREPARING,
      periodStart: input.periodStart || null,
      periodEnd: input.periodEnd || null,
    } as any);

    await auditLogService.log({
      userId: input.createdBy,
      operationType: OperationType.CREATE,
      resourceType: 'task',
      resourceId: task.id,
      operationDetails: `创建评估草稿: ${taskName}`,
      success: true,
      departmentId: input.departmentId,
    });

    return task;
  }

  async getTaskById(id: string) {
    const task = await AuditTask.findByPk(id, {
      include: [
        { association: 'template', attributes: ['id', 'name', 'description'] },
        { association: 'creator', attributes: ['id', 'username'] },
        { association: 'assignee', attributes: ['id', 'username'] },
        { association: 'reviewer', attributes: ['id', 'username'] },
        { association: 'auditors', include: [{ association: 'auditor', attributes: ['id', 'username', 'email'] }] },
        {
          association: 'assessmentAssets',
          attributes: [
            'id', 'assetId', 'scopeStatus', 'assetCodeSnapshot', 'assetNameSnapshot',
            'assetTypeSnapshot', 'criticalitySnapshot', 'ownerDepartmentIdSnapshot',
            'ownerDepartmentNameSnapshot',
          ],
        },
      ],
    });
    if (!task) throw new Error('任务不存在');
    const [total, reviewed, findings] = await Promise.all([
      QuestionItem.count({ where: { taskId: id } }),
      QuestionItem.count({ where: { taskId: id, workflowStatus: EvaluationWorkflowStatus.REVIEWED } }),
      Finding.count({ where: { taskId: id } }),
    ]);
    return { ...task.toJSON(), progress: { total, reviewed, findings } };
  }

  async syncColumnSchema(id: string, updatedBy: string) {
    const task = await AuditTask.findByPk(id);
    if (!task) throw new AppError(404, 'NOT_FOUND', '评估项目不存在');
    const template = await QuestionnaireTemplate.findByPk(task.templateId, {
      attributes: ['id', 'name', 'columnSchema'],
    });
    if (!template) throw new AppError(409, 'TEMPLATE_NOT_FOUND', '项目关联的模板不存在，无法同步列配置');

    const columnSchemaSnapshot = normalizeEvaluationColumnSchema(template.columnSchema || []);
    await task.update({ columnSchemaSnapshot });
    await auditLogService.log({
      userId: updatedBy,
      operationType: OperationType.UPDATE,
      resourceType: 'task',
      resourceId: task.id,
      operationDetails: `同步模板“${template.name}”的列配置，仅更新列顺序、名称和显示状态`,
      success: true,
      departmentId: task.departmentId,
    });

    return { columnSchemaSnapshot, templateId: template.id, templateName: template.name };
  }

  // ============ 查询（带过滤 + 统计）============

  private async getTasks(query: TaskQuery) {
    const { page, pageSize } = parsePagination(query);
    const { status, assessmentType } = query;
    const where: any = query.user
      ? await objectAccessService.taskScope(query.user, 'read', query.my === 'true')
      : {};
    if (query.my === 'true') where.status = { [Op.ne]: TaskStatus.PREPARING };

    if (status) where.status = status;
    if (assessmentType) where.assessmentType = assessmentType;

    const { count, rows } = await AuditTask.findAndCountAll({
      where,
      include: [
        { association: 'template', attributes: ['id', 'name'] },
        { association: 'creator', attributes: ['id', 'username'] },
        { association: 'assignee', attributes: ['id', 'username'] },
        { association: 'reviewer', attributes: ['id', 'username'] },
        { association: 'auditors', include: [{ association: 'auditor', attributes: ['id', 'username'] }] },
      ],
      order: [['createdAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      distinct: true,
    });

    return {
      items: rows,
      pagination: pagination(page, pageSize, count),
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
      where: { taskId: { [Op.in]: taskIds }, workflowStatus: EvaluationWorkflowStatus.REVIEWED },
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
        where: { taskId: { [Op.in]: taskIds }, assignedTo: query.userId, workflowStatus: EvaluationWorkflowStatus.REVIEWED },
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
