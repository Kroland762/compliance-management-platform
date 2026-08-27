import { Op, type WhereOptions } from 'sequelize';
import {
  Asset,
  AssessmentAuditor,
  AssessmentPlan,
  AuditTask,
  Department,
  Qualification,
  Finding,
  FindingActionLink,
  QuestionItem,
  EvaluationHistoryLink,
  RemediationAction,
  RiskActionLink,
  RiskRecord,
  Product,
  ProductComplianceDossier,
  ProductVersion,
} from '../models';
import type { DataScope, PermissionResource } from '../models';
import type AccountAuditTaskModel from '../models/account/AuditTask';
import type AccountDataSourceModel from '../models/account/DataSource';
import type ProblemAccountModel from '../models/account/ProblemAccount';
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
    if (scope === 'all' && !onlyAssignedQuestions) return {};
    const assigned = await QuestionItem.findAll({
      where: { assignedTo: user.userId },
      attributes: ['taskId'],
      group: ['taskId'],
      raw: true,
    });
    const auditorAssignments = await AssessmentAuditor.findAll({
      where: { auditorUserId: user.userId },
      attributes: ['taskId'],
      raw: true,
    });
    const assignedIds = [...new Set([
      ...assigned.map((row: any) => row.taskId),
      ...auditorAssignments.map((row: any) => row.taskId),
    ])];
    if (onlyAssignedQuestions || scope === 'assigned') {
      return {
        [Op.or]: [
          { assignedTo: user.userId },
          { reviewerId: user.userId },
          { id: { [Op.in]: assignedIds } },
        ],
      };
    }
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
    const risk = await RiskRecord.findOne({
      where: { id, ...(await this.riskScope(user, action) as object) },
    });
    if (!risk) throw new AppError(404, 'NOT_FOUND', '风险记录不存在');
    return risk;
  }

  async assetScope(user: RequestUser, action = 'read'): Promise<WhereOptions> {
    const scope = this.scope(user, 'assets', action);
    if (scope === 'all') return {};
    if (scope === 'department' || scope === 'department_tree') {
      return { ownerDepartmentId: { [Op.in]: await this.departmentIds(user, scope) } };
    }
    return { ownerUserId: user.userId };
  }

  async assetOrNotFound(id: string, user: RequestUser, action = 'read'): Promise<Asset> {
    const asset = await Asset.findOne({
      where: { id, ...(await this.assetScope(user, action) as object) },
    });
    if (!asset) throw new AppError(404, 'NOT_FOUND', '资产不存在');
    return asset;
  }

  async accountDataSourceScope(user: RequestUser, action = 'read'): Promise<WhereOptions> {
    if (this.scope(user, 'data_sources', action) === 'all') return {};
    return { createdBy: user.userId };
  }

  async accountDataSourceOrNotFound(id: string, user: RequestUser, action = 'read'): Promise<AccountDataSourceModel> {
    const { default: AccountDataSource } = await import('../models/account/DataSource');
    const source = await AccountDataSource.findOne({
      where: { id, ...(await this.accountDataSourceScope(user, action) as object) },
    });
    if (!source) throw new AppError(404, 'NOT_FOUND', '数据源不存在');
    return source;
  }

  async accountTaskScope(user: RequestUser, action = 'read'): Promise<WhereOptions> {
    if (this.scope(user, 'account_tasks', action) === 'all') return {};
    return { createdBy: user.userId };
  }

  async accountTaskOrNotFound(id: string, user: RequestUser, action = 'read'): Promise<AccountAuditTaskModel> {
    const { default: AccountAuditTask } = await import('../models/account/AuditTask');
    const task = await AccountAuditTask.findOne({
      where: { id, ...(await this.accountTaskScope(user, action) as object) },
    });
    if (!task) throw new AppError(404, 'NOT_FOUND', '审计任务不存在');
    return task;
  }

  async accountProblemScope(user: RequestUser, action = 'read'): Promise<WhereOptions> {
    const scope = this.scope(user, 'problems', action);
    if (scope === 'all') return {};
    const { default: AccountAuditTask } = await import('../models/account/AuditTask');
    const tasks = await AccountAuditTask.findAll({
      where: { createdBy: user.userId },
      attributes: ['id'],
      raw: true,
    });
    return { taskId: { [Op.in]: tasks.map((task: any) => task.id) } };
  }

  async accountProblemOrNotFound(id: string, user: RequestUser, action = 'read'): Promise<ProblemAccountModel> {
    const { default: ProblemAccount } = await import('../models/account/ProblemAccount');
    const problem = await ProblemAccount.findOne({
      where: { id, ...(await this.accountProblemScope(user, action) as object) },
    });
    if (!problem) throw new AppError(404, 'NOT_FOUND', '问题记录不存在');
    return problem;
  }

  async assessmentPlanScope(user: RequestUser, action = 'read'): Promise<WhereOptions> {
    const scope = this.scope(user, 'assessment_plans', action);
    if (scope === 'all') return {};
    if (scope === 'department' || scope === 'department_tree') {
      return { defaultDepartmentId: { [Op.in]: await this.departmentIds(user, scope) } };
    }
    return { createdBy: user.userId };
  }

  async assessmentPlanOrNotFound(id: string, user: RequestUser, action = 'read'): Promise<AssessmentPlan> {
    const plan = await AssessmentPlan.findOne({
      where: { id, ...(await this.assessmentPlanScope(user, action) as object) },
    });
    if (!plan) throw new AppError(404, 'NOT_FOUND', '周期评估计划不存在');
    return plan;
  }

  async productScope(user: RequestUser, resource: 'products' | 'product_dossiers' = 'products', action = 'read'): Promise<WhereOptions> {
    const scope = this.scope(user, resource, action);
    if (scope === 'all') return {};
    if (scope === 'department' || scope === 'department_tree') {
      return { ownerDepartmentId: { [Op.in]: await this.departmentIds(user, scope) } };
    }
    return scope === 'assigned'
      ? { ownerUserId: user.userId }
      : { [Op.or]: [{ ownerUserId: user.userId }, { createdBy: user.userId }] };
  }

  async productOrNotFound(id: string, user: RequestUser, action = 'read'): Promise<Product> {
    const product = await Product.findOne({ where: { id, ...(await this.productScope(user, 'products', action) as object) } });
    if (!product) throw new AppError(404, 'NOT_FOUND', '产品不存在');
    return product;
  }

  async dossierOrNotFound(id: string, user: RequestUser, action = 'read'): Promise<ProductComplianceDossier> {
    const dossier = await ProductComplianceDossier.findOne({
      where: { id },
      include: [{
        model: ProductVersion,
        as: 'productVersion',
        required: true,
        include: [{ model: Product, as: 'product', where: await this.productScope(user, 'product_dossiers', action), required: true }],
      }],
    });
    if (!dossier) throw new AppError(404, 'NOT_FOUND', '产品合规档案不存在');
    return dossier;
  }

  async evaluationOrNotFound(id: string, user: RequestUser, action = 'read'): Promise<QuestionItem> {
    const item = await QuestionItem.findOne({
      where: { id, ...(await this.evaluationScope(user, action) as object) },
    });
    if (!item) throw new AppError(404, 'NOT_FOUND', '评估单元不存在');
    return item;
  }

  async evaluationScope(user: RequestUser, action = 'read'): Promise<WhereOptions> {
    const scope = this.scope(user, 'evaluations', action);
    if (scope === 'all') return {};
    if (scope === 'department' || scope === 'department_tree') {
      return { responsibleDepartmentId: { [Op.in]: await this.departmentIds(user, scope) } };
    }
    if (scope === 'assigned') {
      const taskAssignments = await AssessmentAuditor.findAll({
        where: { auditorUserId: user.userId },
        attributes: ['taskId'],
        raw: true,
      });
      return {
        [Op.or]: [
          { assignedTo: user.userId },
          { reviewedBy: user.userId },
          { reviewClaimedBy: user.userId },
          { taskId: { [Op.in]: taskAssignments.map((task: any) => task.taskId) } },
        ],
      };
    }
    return { [Op.or]: [{ assignedTo: user.userId }, { reviewedBy: user.userId }] };
  }

  async findingScope(user: RequestUser): Promise<WhereOptions> {
    const scope = this.scope(user, 'findings', 'read');
    if (scope === 'all') return {};
    if (scope === 'department' || scope === 'department_tree') {
      return { ownerDepartmentId: { [Op.in]: await this.departmentIds(user, scope) } };
    }
    const visibleTaskIds = await this.accessibleTaskIds(user);
    return {
      [Op.or]: [
        { ownerUserId: user.userId },
        ...(visibleTaskIds === null ? [] : [{ taskId: { [Op.in]: visibleTaskIds } }]),
      ],
    };
  }

  async findingOrNotFound(id: string, user: RequestUser): Promise<Finding> {
    const finding = await Finding.findOne({ where: { id, ...(await this.findingScope(user) as object) } });
    if (!finding) throw new AppError(404, 'NOT_FOUND', '不符合项不存在');
    return finding;
  }

  async riskScope(user: RequestUser, action = 'read'): Promise<WhereOptions> {
    const scope = this.scope(user, 'risks', action);
    if (scope === 'all') return {};
    if (scope === 'department' || scope === 'department_tree') {
      return { ownerDepartmentId: { [Op.in]: await this.departmentIds(user, scope) } };
    }
    if (scope === 'assigned') {
      const tasks = await AuditTask.findAll({
        where: await this.taskScope(user, 'read', true),
        attributes: ['id'],
        raw: true,
      });
      return {
        [Op.or]: [
          { ownerUserId: user.userId },
          { taskId: { [Op.in]: tasks.map((task: any) => task.id) } },
        ],
      };
    }
    return { ownerUserId: user.userId };
  }

  async accessibleRiskIds(user: RequestUser, action = 'read'): Promise<string[] | null> {
    if (this.scope(user, 'risks', action) === 'all') return null;
    const risks = await RiskRecord.findAll({
      where: await this.riskScope(user, action),
      attributes: ['id'],
      raw: true,
    });
    return risks.map((risk: any) => risk.id);
  }

  async remediationScope(user: RequestUser, action = 'read'): Promise<WhereOptions> {
    const scope = this.scope(user, 'remediation_actions', action);
    if (scope === 'all') return {};
    const visibleRiskIds = await this.accessibleRiskIds(user, 'read');
    const linkedActionIds = (await RiskActionLink.findAll({
      where: visibleRiskIds === null ? {} : { riskId: { [Op.in]: visibleRiskIds } },
      attributes: ['actionId'],
      group: ['actionId'],
      raw: true,
    })).map((link: any) => link.actionId);
    const visibleFindings = await Finding.findAll({
      where: await this.findingScope(user),
      attributes: ['id'],
      raw: true,
    });
    const findingActionIds = visibleFindings.length
      ? (await FindingActionLink.findAll({
        where: { findingId: { [Op.in]: visibleFindings.map((finding: any) => finding.id) } },
        attributes: ['actionId'],
        raw: true,
      })).map((link: any) => link.actionId)
      : [];
    const linked = { id: { [Op.in]: [...new Set([...linkedActionIds, ...findingActionIds])] } };
    if (scope === 'department' || scope === 'department_tree') {
      return {
        [Op.or]: [
          { ownerDepartmentId: { [Op.in]: await this.departmentIds(user, scope) } },
          linked,
        ],
      };
    }
    return { [Op.or]: [{ ownerUserId: user.userId }, linked] };
  }

  async remediationOrNotFound(id: string, user: RequestUser, action = 'read'): Promise<RemediationAction> {
    const remediation = await RemediationAction.findOne({
      where: { id, ...(await this.remediationScope(user, action) as object) },
    });
    if (!remediation) throw new AppError(404, 'NOT_FOUND', '整改行动不存在');
    return remediation;
  }

  async riskActionLinkOrNotFound(
    riskId: string,
    actionId: string,
    user: RequestUser,
    action = 'read',
  ): Promise<RiskActionLink> {
    await this.riskOrNotFound(riskId, user, action === 'verify' ? 'verify' : 'read');
    const link = await RiskActionLink.findOne({ where: { riskId, actionId } });
    if (!link) throw new AppError(404, 'NOT_FOUND', '风险整改关联不存在');
    return link;
  }

  async questionOrNotFound(id: string, user: RequestUser, write = false): Promise<QuestionItem> {
    return this.evaluationOrNotFound(id, user, write ? 'answer' : 'read');
  }

  async questionOrHistorySourceNotFound(id: string, user: RequestUser): Promise<QuestionItem> {
    try {
      return await this.evaluationOrNotFound(id, user, 'read');
    } catch (error) {
      const links = await EvaluationHistoryLink.findAll({ where: { sourceEvaluationId: id }, attributes: ['currentEvaluationId'] });
      for (const link of links) {
        try {
          await this.evaluationOrNotFound(link.currentEvaluationId, user, 'read');
          const item = await QuestionItem.findByPk(id);
          if (item) return item;
        } catch { /* try the next explicitly linked current evaluation */ }
      }
      throw error;
    }
  }
}

export default new ObjectAccessService();
