import { Op, fn, col, Transaction } from 'sequelize';
import sequelize from '../../config/database';
import { encodeCsv } from '../../utils/csv';
import {
  ProblemAccount,
  ProblemStatus,
  AuditRule,
  AccountData,
  Severity,
  ProblemStatusHistory,
  ProblemStatusChangeSource,
} from '../../models/account';
import auditLogService from '../audit-log.service';
import { OperationType } from '../../models';
import { parsePagination, pagination } from '../../utils/pagination';
import objectAccessService from '../object-access.service';

type RequestUser = NonNullable<Express.Request['user']>;

interface ListQuery {
  page?: number;
  pageSize?: number;
  taskId?: string;
  ruleId?: string;
  status?: ProblemStatus;
  severity?: Severity;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface BulkUpdateInput {
  ids: string[];
  status: ProblemStatus;
  notes?: string;
}

class ProblemService {
  private assertStatus(value: unknown): ProblemStatus {
    if (!Object.values(ProblemStatus).includes(value as ProblemStatus)) {
      throw new Error(`非法问题状态: ${String(value)}`);
    }
    return value as ProblemStatus;
  }

  private updatesForStatus(status: ProblemStatus, userId: string, notes?: string) {
    const updates: Record<string, unknown> = { status };
    if (notes !== undefined) updates.resolutionNotes = notes;
    if ([ProblemStatus.RESOLVED, ProblemStatus.AUTO_RESOLVED, ProblemStatus.FALSE_POSITIVE, ProblemStatus.IGNORED].includes(status)) {
      updates.resolvedAt = new Date();
      updates.resolvedBy = userId;
    } else {
      updates.resolvedAt = null;
      updates.resolvedBy = null;
    }
    return updates;
  }

  private buildFilter(query: ListQuery) {
    const { taskId, ruleId, status, severity, search, dateFrom, dateTo } = query;
    const where: any = {};

    if (taskId) where.taskId = taskId;
    if (ruleId) where.ruleId = ruleId;
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (search) {
      where[Op.or] = [
        { accountId: { [Op.iLike]: `%${search}%` } },
        { problemDescription: { [Op.iLike]: `%${search}%` } },
      ];
    }
    if (dateFrom || dateTo) {
      where.firstDetectedAt = {};
      if (dateFrom) where.firstDetectedAt[Op.gte] = new Date(dateFrom);
      if (dateTo) where.firstDetectedAt[Op.lte] = new Date(dateTo);
    }
    return where;
  }

  private async scopedFilter(query: ListQuery, user?: RequestUser, action = 'read') {
    const filter = this.buildFilter(query);
    if (!user || typeof user !== 'object' || !user.userId) return filter;
    const scope = await objectAccessService.accountProblemScope(user, action);
    return { [Op.and]: [scope, filter] };
  }

  /**
   * 分页列出问题账户
   */
  async listProblems(query: ListQuery, user?: RequestUser) {
    const { page, pageSize } = parsePagination(query);
    const where = await this.scopedFilter(query, user, 'read');

    const { count, rows } = await ProblemAccount.findAndCountAll({
      where,
      order: [['firstDetectedAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      include: [
        { model: AccountData, as: 'AccountDatum', attributes: ['accountName'], required: false },
        { model: AuditRule, as: 'AuditRule', attributes: ['name'], required: false },
      ],
    });

    return {
      items: rows.map(r => {
        const json = r.toJSON() as any;
        json.accountName = (json as any).AccountDatum?.accountName || json.accountId;
        json.ruleName = (json as any).AuditRule?.name || json.ruleId?.substring(0, 8) || '—';
        delete (json as any).AccountDatum;
        delete (json as any).AuditRule;
        return json;
      }),
      pagination: pagination(page, pageSize, count),
    };
  }

  /**
   * 获取单个问题详情
   */
  async getProblem(id: string, user?: RequestUser) {
    const where = user ? { id, ...(await objectAccessService.accountProblemScope(user, 'read') as object) } : { id };
    const problem = await ProblemAccount.findOne({
      where,
      include: [
        { model: AccountData, as: 'AccountDatum', attributes: ['accountName'], required: false },
        { model: AuditRule, as: 'AuditRule', attributes: ['name'], required: false },
        { model: ProblemStatusHistory, as: 'statusHistory', required: false },
      ],
      order: [[{ model: ProblemStatusHistory, as: 'statusHistory' }, 'changedAt', 'DESC']],
    });
    if (!problem) throw new Error('问题记录不存在');
    const json = problem.toJSON() as any;
    json.accountName = json.AccountDatum?.accountName || json.accountId;
    json.ruleName = json.AuditRule?.name || json.ruleId?.substring(0, 8) || '—';
    delete json.AccountDatum;
    delete json.AuditRule;
    return json;
  }

  /**
   * 更新问题状态
   * 支持状态流转: PENDING → PROCESSING → RESOLVED / FALSE_POSITIVE / IGNORED
   */
  async updateStatus(id: string, status: ProblemStatus, actor: RequestUser | string, notes?: string) {
    const next = this.assertStatus(status);
    const user = typeof actor === 'object' ? actor : undefined;
    const userId = typeof actor === 'string' ? actor : actor.userId;
    if (user) await objectAccessService.accountProblemOrNotFound(id, user, 'update');
    const result = await sequelize.transaction(async (transaction) => {
      const problem = await ProblemAccount.findByPk(id, { transaction, lock: Transaction.LOCK.UPDATE });
      if (!problem) throw new Error('问题记录不存在');
      this.validateStatusTransition(problem.status, next);
      const fromStatus = problem.status;
      await problem.update(this.updatesForStatus(next, userId, notes), { transaction });
      await ProblemStatusHistory.create({
        problemId: problem.id,
        fromStatus,
        toStatus: next,
        changedBy: userId,
        source: ProblemStatusChangeSource.MANUAL,
        notes: notes || null,
      }, { transaction });
      return problem.toJSON();
    });

    await auditLogService.log({
      userId,
      operationType: OperationType.UPDATE,
      resourceType: 'problem',
      resourceId: id,
      operationDetails: `更新问题状态为 ${next}`,
      success: true,
    });

    return result;
  }

  /**
   * 批量更新问题状态
   */
  async bulkUpdateStatus(data: BulkUpdateInput, actor: RequestUser | string) {
    const user = typeof actor === 'object' ? actor : undefined;
    const userId = typeof actor === 'string' ? actor : actor.userId;
    if (!data.ids || data.ids.length === 0) {
      throw new Error('请提供要更新的问题ID列表');
    }

    const status = this.assertStatus(data.status);
    const ids = [...new Set(data.ids)];
    const updatedCount = await sequelize.transaction(async (transaction) => {
      const scope = user ? await objectAccessService.accountProblemScope(user, 'update') : {};
      const problems = await ProblemAccount.findAll({
        where: { id: { [Op.in]: ids }, ...(scope as object) },
        transaction,
        lock: Transaction.LOCK.UPDATE,
        order: [['id', 'ASC']],
      });
      if (problems.length !== ids.length) {
        const found = new Set(problems.map((problem) => problem.id));
        throw new Error(`部分问题记录不存在: ${ids.filter((id) => !found.has(id)).join(', ')}`);
      }
      problems.forEach((problem) => this.validateStatusTransition(problem.status, status));
      for (const problem of problems) {
        const fromStatus = problem.status;
        await problem.update(this.updatesForStatus(status, userId, data.notes), { transaction });
        await ProblemStatusHistory.create({
          problemId: problem.id,
          fromStatus,
          toStatus: status,
          changedBy: userId,
          source: ProblemStatusChangeSource.BULK,
          notes: data.notes || null,
        }, { transaction });
      }
      return problems.length;
    });

    await auditLogService.log({
      userId,
      operationType: OperationType.UPDATE,
      resourceType: 'problem',
      resourceId: null,
      operationDetails: `批量更新 ${updatedCount} 个问题状态为 ${status}`,
      success: true,
    });

    return { updatedCount };
  }

  /**
   * 导出问题数据
   */
  async exportProblems(query: ListQuery, user?: RequestUser) {
    const where = await this.scopedFilter(query, user, 'export');

    const problems = await ProblemAccount.findAll({
      where,
      order: [['firstDetectedAt', 'DESC']],
    });

    const items = problems.map(p => p.toJSON());

    const headers = ['ID', 'TaskID', 'RuleID', 'AccountID', 'Description', 'Severity', 'Status', 'FirstDetected', 'ResolvedAt', 'Notes'];
    const csvRows: unknown[][] = [headers];
    for (const p of items) {
      csvRows.push([
        p.id,
        p.taskId,
        p.ruleId,
        p.accountId,
        p.problemDescription || '',
        p.severity,
        p.status,
        p.firstDetectedAt,
        p.resolvedAt || '',
        p.resolutionNotes || '',
      ]);
    }
    return encodeCsv(csvRows);
  }

  /**
   * 获取问题统计（按状态和严重级别）
   */
  async getProblemStats(taskId?: string, user?: RequestUser) {
    const where = await this.scopedFilter({ taskId } as ListQuery, user, 'read');

    // 按状态统计
    const statusCounts = await ProblemAccount.findAll({
      where,
      attributes: ['status', [fn('COUNT', col('id')), 'count']],
      group: ['status'],
    });

    // 按严重级别统计
    const severityCounts = await ProblemAccount.findAll({
      where,
      attributes: ['severity', [fn('COUNT', col('id')), 'count']],
      group: ['severity'],
    });

    const byStatus: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let total = 0;

    for (const r of statusCounts) {
      const s = r as any;
      byStatus[s.status] = Number(s.get('count'));
      total += Number(s.get('count'));
    }
    for (const r of severityCounts) {
      const s = r as any;
      bySeverity[s.severity] = Number(s.get('count'));
    }

    return { total, byStatus, bySeverity };
  }

  /**
   * 状态流转验证
   */
  private validateStatusTransition(current: ProblemStatus, next: ProblemStatus) {
    // 允许的状态流转
    const allowedTransitions: Record<ProblemStatus, ProblemStatus[]> = {
      [ProblemStatus.PENDING]: [
        ProblemStatus.PROCESSING,
        ProblemStatus.RESOLVED,
        ProblemStatus.FALSE_POSITIVE,
        ProblemStatus.IGNORED,
      ],
      [ProblemStatus.PROCESSING]: [
        ProblemStatus.RESOLVED,
        ProblemStatus.FALSE_POSITIVE,
        ProblemStatus.IGNORED,
        ProblemStatus.PENDING, // 可以退回
      ],
      [ProblemStatus.RESOLVED]: [
        ProblemStatus.PENDING, // 重新打开
      ],
      [ProblemStatus.AUTO_RESOLVED]: [
        ProblemStatus.PENDING, // 重新打开
        ProblemStatus.PROCESSING,
      ],
      [ProblemStatus.FALSE_POSITIVE]: [
        ProblemStatus.PENDING, // 重新打开
      ],
      [ProblemStatus.IGNORED]: [
        ProblemStatus.PENDING, // 重新打开
      ],
    };

    const allowed = allowedTransitions[current] || [];
    if (!allowed.includes(next)) {
      throw new Error(`不允许从 ${current} 转换为 ${next}`);
    }
  }
}

export default new ProblemService();
