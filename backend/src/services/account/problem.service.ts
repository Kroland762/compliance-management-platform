import { Op, fn, col } from 'sequelize';
import {
  ProblemAccount,
  ProblemStatus,
  AuditRule,
  AccountData,
  Severity,
} from '../../models/account';
import auditLogService from '../audit-log.service';
import { OperationType } from '../../models';

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
  /**
   * 分页列出问题账户
   */
  async listProblems(query: ListQuery) {
    const { page = 1, pageSize = 20, taskId, ruleId, status, severity, search, dateFrom, dateTo } = query;
    const where: any = {};

    if (taskId) where.taskId = taskId;
    if (ruleId) where.ruleId = ruleId;
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (search) {
      where.problemDescription = { [Op.iLike]: `%${search}%` };
    }
    if (dateFrom || dateTo) {
      where.firstDetectedAt = {};
      if (dateFrom) where.firstDetectedAt[Op.gte] = new Date(dateFrom);
      if (dateTo) where.firstDetectedAt[Op.lte] = new Date(dateTo);
    }

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
      pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
    };
  }

  /**
   * 获取单个问题详情
   */
  async getProblem(id: string) {
    const problem = await ProblemAccount.findByPk(id);
    if (!problem) throw new Error('问题记录不存在');
    return problem.toJSON();
  }

  /**
   * 更新问题状态
   * 支持状态流转: PENDING → PROCESSING → RESOLVED / FALSE_POSITIVE / IGNORED
   */
  async updateStatus(id: string, status: ProblemStatus, userId: string, notes?: string) {
    const problem = await ProblemAccount.findByPk(id);
    if (!problem) throw new Error('问题记录不存在');

    // 验证状态流转合法性
    this.validateStatusTransition(problem.status, status);

    const updates: any = { status };
    if (notes !== undefined) updates.resolutionNotes = notes;

    if ([ProblemStatus.RESOLVED, ProblemStatus.AUTO_RESOLVED, ProblemStatus.FALSE_POSITIVE, ProblemStatus.IGNORED].includes(status)) {
      updates.resolvedAt = new Date();
      updates.resolvedBy = userId;
    }

    // 如果从已解决状态重新打开
    if (status === ProblemStatus.PENDING || status === ProblemStatus.PROCESSING) {
      updates.resolvedAt = null;
      updates.resolvedBy = null;
    }

    await problem.update(updates);

    await auditLogService.log({
      userId,
      operationType: OperationType.UPDATE,
      resourceType: 'problem',
      resourceId: id,
      operationDetails: `更新问题状态: ${problem.status} → ${status}`,
      success: true,
    });

    return problem.toJSON();
  }

  /**
   * 批量更新问题状态
   */
  async bulkUpdateStatus(data: BulkUpdateInput, userId: string) {
    if (!data.ids || data.ids.length === 0) {
      throw new Error('请提供要更新的问题ID列表');
    }

    const problems = await ProblemAccount.findAll({
      where: { id: { [Op.in]: data.ids } },
    });

    if (problems.length === 0) {
      throw new Error('未找到匹配的问题记录');
    }

    const isFinalStatus = [ProblemStatus.RESOLVED, ProblemStatus.AUTO_RESOLVED, ProblemStatus.FALSE_POSITIVE, ProblemStatus.IGNORED].includes(data.status);

    const updates: any = {
      status: data.status,
    };
    if (data.notes !== undefined) updates.resolutionNotes = data.notes;
    if (isFinalStatus) {
      updates.resolvedAt = new Date();
      updates.resolvedBy = userId;
    }

    if (data.status === ProblemStatus.PENDING || data.status === ProblemStatus.PROCESSING) {
      updates.resolvedAt = null;
      updates.resolvedBy = null;
    }

    const ids = data.ids;
    await ProblemAccount.update(updates, {
      where: { id: { [Op.in]: ids } },
    });

    await auditLogService.log({
      userId,
      operationType: OperationType.UPDATE,
      resourceType: 'problem',
      resourceId: null,
      operationDetails: `批量更新 ${ids.length} 个问题状态为 ${data.status}`,
      success: true,
    });

    return { updatedCount: ids.length };
  }

  /**
   * 导出问题数据
   */
  async exportProblems(query: ListQuery, format: 'csv' | 'json' = 'json') {
    const { taskId, ruleId, status, severity, dateFrom, dateTo } = query;
    const where: any = {};

    if (taskId) where.taskId = taskId;
    if (ruleId) where.ruleId = ruleId;
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (dateFrom || dateTo) {
      where.firstDetectedAt = {};
      if (dateFrom) where.firstDetectedAt[Op.gte] = new Date(dateFrom);
      if (dateTo) where.firstDetectedAt[Op.lte] = new Date(dateTo);
    }

    const problems = await ProblemAccount.findAll({
      where,
      order: [['firstDetectedAt', 'DESC']],
    });

    const items = problems.map(p => p.toJSON());

    if (format === 'json') {
      return items;
    }

    // CSV 格式
    const headers = ['ID', 'TaskID', 'RuleID', 'AccountID', 'Description', 'Severity', 'Status', 'FirstDetected', 'ResolvedAt', 'Notes'];
    const csvRows = [headers.join(',')];

    for (const p of items) {
      csvRows.push([
        p.id,
        p.taskId,
        p.ruleId,
        p.accountId,
        `"${(p.problemDescription || '').replace(/"/g, '""')}"`,
        p.severity,
        p.status,
        p.firstDetectedAt,
        p.resolvedAt || '',
        `"${(p.resolutionNotes || '').replace(/"/g, '""')}"`,
      ].join(','));
    }

    return csvRows.join('\n');
  }

  /**
   * 获取问题统计（按状态和严重级别）
   */
  async getProblemStats(taskId?: string) {
    const where: any = {};
    if (taskId) where.taskId = taskId;

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
