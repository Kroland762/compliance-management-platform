import { AuditTask, EvidenceFile, QuestionItem } from '../models';
import type { PermissionMatrix } from '../models/Role';

export type TaskObjectAction = 'read' | 'respond' | 'review' | 'manage' | 'delete';

export interface AccessActor {
  userId: string;
  tenantId?: string;
  permissions: PermissionMatrix;
}

export class ObjectAccessError extends Error {
  readonly statusCode: number;
  readonly code: 'NOT_FOUND' | 'OBJECT_FORBIDDEN';

  constructor(message: string, code: 'NOT_FOUND' | 'OBJECT_FORBIDDEN' = 'OBJECT_FORBIDDEN') {
    super(message);
    this.name = 'ObjectAccessError';
    this.code = code;
    this.statusCode = code === 'NOT_FOUND' ? 404 : 403;
  }
}

function hasTaskPermission(actor: AccessActor, action: string): boolean {
  return actor.permissions?.tasks?.includes(action) === true;
}

/**
 * Object-level authorization for audit tasks.
 * Tenant isolation is supplied by the tenant schema; this layer limits access
 * inside the tenant to task owners, reviewers and assigned respondents.
 */
class ObjectAccessService {
  hasTenantWideTaskScope(actor: AccessActor): boolean {
    return hasTaskPermission(actor, 'delete');
  }

  async assertTaskAccess(taskId: string, actor: AccessActor, action: TaskObjectAction): Promise<AuditTask> {
    const task = await AuditTask.findByPk(taskId);
    if (!task) throw new ObjectAccessError('任务不存在', 'NOT_FOUND');

    if (this.hasTenantWideTaskScope(actor)) return task;

    const isCreator = task.createdBy === actor.userId;
    const isReviewer = task.reviewerId === actor.userId;
    const isTaskAssignee = task.assignedTo === actor.userId;

    if (action === 'delete') {
      throw new ObjectAccessError('无权删除该任务');
    }
    if (action === 'manage' && (isCreator || isReviewer)) return task;
    if (action === 'review' && isReviewer) return task;
    if (action === 'respond' && isTaskAssignee) return task;
    if (action === 'read' && (isCreator || isReviewer || isTaskAssignee)) return task;

    const assignedQuestion = await QuestionItem.count({
      where: { taskId, assignedTo: actor.userId },
    });
    if (assignedQuestion > 0 && (action === 'read' || action === 'respond')) return task;

    throw new ObjectAccessError('无权访问该任务');
  }

  async assertQuestionAccess(questionId: string, actor: AccessActor, action: TaskObjectAction): Promise<QuestionItem> {
    const item = await QuestionItem.findByPk(questionId);
    if (!item) throw new ObjectAccessError('问卷条目不存在', 'NOT_FOUND');

    if (this.hasTenantWideTaskScope(actor)) return item;
    if ((action === 'read' || action === 'respond') && item.assignedTo === actor.userId) return item;

    await this.assertTaskAccess(item.taskId, actor, action);
    return item;
  }

  async assertEvidenceAccess(evidenceId: string, actor: AccessActor, action: TaskObjectAction): Promise<EvidenceFile> {
    const evidence = await EvidenceFile.findByPk(evidenceId);
    if (!evidence) throw new ObjectAccessError('证据文件不存在', 'NOT_FOUND');
    await this.assertQuestionAccess(evidence.questionItemId, actor, action);
    return evidence;
  }
}

export default new ObjectAccessService();
