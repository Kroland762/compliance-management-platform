import { Op, fn, col } from 'sequelize';
import { DataSource, AccountData, ProblemAccount, ProblemStatus, DataSourceStatus, Severity } from '../../models/account';
import objectAccessService from '../object-access.service';

type RequestUser = NonNullable<Express.Request['user']>;

class DashboardService {
  /**
   * 全局概览：数据源数、总账户数、总问题数、高风险数、待处理数
   */
  async getOverview(user: RequestUser) {
    const dataSourceScope = await objectAccessService.accountDataSourceScope(user, 'read');
    const problemScope = await objectAccessService.accountProblemScope(user, 'read');
    const [dataSourcesCount, accountCounts] = await Promise.all([
      DataSource.count({ where: { status: DataSourceStatus.ACTIVE, ...(dataSourceScope as object) } }),
      AccountData.findAll({
        attributes: [[fn('COUNT', col('id')), 'count']],
        where: Object.keys(dataSourceScope as object).length ? {
          sourceId: { [Op.in]: (await DataSource.findAll({ where: dataSourceScope, attributes: ['id'], raw: true })).map((row: any) => row.id) },
        } : {},
        raw: true,
      }),
    ]);

    const totalAccounts = Number((accountCounts[0] as any).count) || 0;

    // 高风险 (HIGH)
    const highRiskCount = await ProblemAccount.count({
      where: {
        ...(problemScope as object),
        severity: Severity.HIGH,
        status: { [Op.in]: [ProblemStatus.PENDING, ProblemStatus.PROCESSING] },
      },
    });

    // 待处理问题
    const pendingCount = await ProblemAccount.count({
      where: {
        ...(problemScope as object),
        status: { [Op.in]: [ProblemStatus.PENDING, ProblemStatus.PROCESSING] },
      },
    });

    const totalProblems = await ProblemAccount.count({ where: problemScope });

    return {
      dataSourcesCount,
      totalAccounts,
      totalProblems,
      highRiskCount,
      pendingCount,
    };
  }

  /**
   * 趋势：最近 N 天每天新增的问题数
   */
  async getTrends(days: number = 30, user: RequestUser) {
    const problemScope = await objectAccessService.accountProblemScope(user, 'read');
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    const problems = await ProblemAccount.findAll({
      where: {
        ...(problemScope as object),
        firstDetectedAt: { [Op.gte]: sinceDate },
      },
      attributes: [
        [fn('DATE', col('firstDetectedAt')), 'date'],
        [fn('COUNT', col('id')), 'count'],
      ],
      group: [fn('DATE', col('firstDetectedAt'))],
      order: [[fn('DATE', col('firstDetectedAt')), 'ASC']],
      raw: true,
    });

    // 补全没有数据的日期
    const trends: Array<{ date: string; count: number }> = [];
    const dataMap = new Map<string, number>();
    for (const p of problems) {
      const d = p as any;
      dataMap.set(d.date, Number(d.count));
    }

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      trends.push({ date: dateStr, count: dataMap.get(dateStr) || 0 });
    }

    return trends;
  }

  /**
   * 风险分布：按严重级别统计问题数
   */
  async getRiskDistribution(user: RequestUser) {
    const problemScope = await objectAccessService.accountProblemScope(user, 'read');
    const distribution = await ProblemAccount.findAll({
      where: problemScope,
      attributes: ['severity', [fn('COUNT', col('id')), 'count']],
      group: ['severity'],
      raw: true,
    });

    const result: Record<string, number> = {
      [Severity.HIGH]: 0,
      [Severity.MEDIUM]: 0,
      [Severity.LOW]: 0,
    };

    for (const d of distribution) {
      const item = d as any;
      result[item.severity] = Number(item.count);
    }

    return result;
  }

  /**
   * 数据源排名：按问题数降序排列
   */
  async getSourceRanking(limit: number = 10, user: RequestUser) {
    const problemScope = await objectAccessService.accountProblemScope(user, 'read');
    const ranking = await ProblemAccount.findAll({
      attributes: [
        'taskId',
        [fn('COUNT', col('id')), 'problemCount'],
      ],
      where: {
        ...(problemScope as object),
        status: { [Op.in]: [ProblemStatus.PENDING, ProblemStatus.PROCESSING] },
      },
      group: ['taskId'],
      order: [[fn('COUNT', col('id')), 'DESC']],
      limit,
      raw: true,
    });

    // 通过 task 关联到 source
    const { AccountAuditTask } = require('../../models/account');
    const result = [];

    for (const r of ranking) {
      const item = r as any;
      try {
        const task = await AccountAuditTask.findByPk(item.taskId, { attributes: ['sourceId', 'name'] });
        if (task) {
          const ds = await DataSource.findOne({
            where: { id: task.sourceId, ...(await objectAccessService.accountDataSourceScope(user, 'read') as object) },
            attributes: ['name'],
          });
          result.push({
            taskId: item.taskId,
            taskName: task.name,
            sourceName: ds?.name || '未知',
            problemCount: Number(item.problemCount),
          });
        }
      } catch {
        // skip
      }
    }

    return result;
  }
}

export default new DashboardService();
