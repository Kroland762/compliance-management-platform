import { Op } from 'sequelize';
import {
  AuditTask,
  Finding,
  FindingStatus,
  Qualification,
  QuestionItem,
  QuestionnaireTemplate,
  RemediationAction,
  RemediationActionStatus,
  RiskLifecycleStatus,
  RiskRecord,
  TaskStatus,
} from '../models';
import objectAccessService from './object-access.service';
import workItemService from './work-item.service';

type RequestUser = NonNullable<Express.Request['user']>;

class ReportingService {
  async dashboard(user: RequestUser) {
    const can = (resource: string, action: string) =>
      (user.permissions as Record<string, string[] | undefined>)[resource]?.includes(action) === true;
    const taskWhere = await objectAccessService.taskScope(user);
    const taskStats = await AuditTask.findAll({
      where: taskWhere,
      attributes: [
        'status',
        [AuditTask.sequelize!.fn('COUNT', AuditTask.sequelize!.col('id')), 'count'],
      ],
      group: ['status'],
      raw: true,
    });
    const taskStatusMap: Record<string, number> = {};
    taskStats.forEach((row: any) => { taskStatusMap[row.status] = Number(row.count); });
    const taskTotal = Object.values(taskStatusMap).reduce((sum, value) => sum + value, 0);
    const taskIds = objectAccessService.canReadAllTasks(user)
      ? null
      : (await AuditTask.findAll({ where: taskWhere, attributes: ['id'], raw: true })).map((row: any) => row.id);
    const evaluationWhere = taskIds === null ? {} : { taskId: { [Op.in]: taskIds } };

    const riskWhere = can('risks', 'read')
      ? await objectAccessService.riskScope(user)
      : { id: null };
    const remediationWhere = can('remediation_actions', 'read')
      ? await objectAccessService.remediationScope(user)
      : { id: null };
    const qualificationWhere = can('qualifications', 'read')
      ? await objectAccessService.qualificationScope(user)
      : null;
    const openStatuses = [
      RiskLifecycleStatus.OPEN,
      RiskLifecycleStatus.REMEDIATING,
      RiskLifecycleStatus.PENDING_VERIFICATION,
    ];
    const activeRiskWhere = {
      ...(riskWhere as object),
      status: { [Op.ne]: RiskLifecycleStatus.CANCELLED },
    };
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);

    const [
      riskLevelRows,
      riskTotal,
      highRisks,
      unresolvedRisks,
      overdueActions,
      evaluationTotal,
      evaluationReviewed,
      templates,
      qualificationRows,
      createdTrendRows,
      closedTrendRows,
      openFindings,
      workItems,
    ] = await Promise.all([
      can('risks', 'read') ? RiskRecord.findAll({
        where: activeRiskWhere,
        attributes: [
          'riskLevel',
          [RiskRecord.sequelize!.fn('COUNT', RiskRecord.sequelize!.col('id')), 'count'],
        ],
        group: ['riskLevel'],
        raw: true,
      }) : [],
      can('risks', 'read') ? RiskRecord.count({ where: activeRiskWhere }) : 0,
      can('risks', 'read') ? RiskRecord.count({
        where: { ...activeRiskWhere, riskLevel: { [Op.in]: ['high', 'critical'] } },
      }) : 0,
      can('risks', 'read') ? RiskRecord.count({
        where: { ...(riskWhere as object), status: { [Op.in]: openStatuses } },
      }) : 0,
      can('remediation_actions', 'read') ? RemediationAction.count({
        where: {
          ...(remediationWhere as object),
          dueDate: { [Op.lt]: new Date() },
          status: { [Op.notIn]: [RemediationActionStatus.COMPLETED, RemediationActionStatus.CANCELLED] },
        },
      }) : 0,
      taskIds?.length === 0 ? 0 : QuestionItem.count({ where: evaluationWhere }),
      taskIds?.length === 0 ? 0 : QuestionItem.count({
        where: { ...(evaluationWhere as object), workflowStatus: 'reviewed' },
      }),
      can('templates', 'read') ? QuestionnaireTemplate.count() : 0,
      qualificationWhere ? Qualification.findAll({
        where: qualificationWhere,
        attributes: [
          [Qualification.sequelize!.literal('COUNT(*)::int'), 'total'],
          [Qualification.sequelize!.literal(
            'COUNT(*) FILTER (WHERE "expiryDate" > CURRENT_DATE + INTERVAL \'30 days\')::int',
          ), 'valid'],
          [Qualification.sequelize!.literal(
            'COUNT(*) FILTER (WHERE "expiryDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL \'30 days\')::int',
          ), 'expiring'],
          [Qualification.sequelize!.literal(
            'COUNT(*) FILTER (WHERE "expiryDate" < CURRENT_DATE)::int',
          ), 'expired'],
          [Qualification.sequelize!.literal(
            'COUNT(*) FILTER (WHERE "expiryDate" IS NULL)::int',
          ), 'missing'],
        ],
        raw: true,
      }) : [],
      can('risks', 'read') ? RiskRecord.findAll({
        where: { ...activeRiskWhere, confirmedAt: { [Op.gte]: sixMonthsAgo } },
        attributes: [
          [RiskRecord.sequelize!.fn('to_char', RiskRecord.sequelize!.fn('date_trunc', 'month', RiskRecord.sequelize!.col('confirmedAt')), 'YYYY-MM'), 'month'],
          [RiskRecord.sequelize!.fn('COUNT', RiskRecord.sequelize!.col('id')), 'count'],
        ],
        group: [RiskRecord.sequelize!.fn('date_trunc', 'month', RiskRecord.sequelize!.col('confirmedAt'))],
        raw: true,
      }) : [],
      can('risks', 'read') ? RiskRecord.findAll({
        where: { ...activeRiskWhere, closedAt: { [Op.gte]: sixMonthsAgo } },
        attributes: [
          [RiskRecord.sequelize!.fn('to_char', RiskRecord.sequelize!.fn('date_trunc', 'month', RiskRecord.sequelize!.col('closedAt')), 'YYYY-MM'), 'month'],
          [RiskRecord.sequelize!.fn('COUNT', RiskRecord.sequelize!.col('id')), 'count'],
        ],
        group: [RiskRecord.sequelize!.fn('date_trunc', 'month', RiskRecord.sequelize!.col('closedAt'))],
        raw: true,
      }) : [],
      can('findings', 'read') ? Finding.count({
        where: {
          ...(await objectAccessService.findingScope(user) as object),
          status: { [Op.notIn]: [FindingStatus.RESOLVED, FindingStatus.CANCELLED] },
        },
      }) : 0,
      (can('evaluations', 'read') || can('remediation_actions', 'read'))
        ? workItemService.list(user)
        : { counts: { fill: 0, review: 0, remediate: 0, verify: 0 } },
    ]);

    const riskLevelMap: Record<string, number> = {};
    riskLevelRows.forEach((row: any) => { riskLevelMap[row.riskLevel] = Number(row.count); });
    const trendMap = new Map<string, { month: string; created: number; closed: number }>();
    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() - offset);
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      trendMap.set(month, { month, created: 0, closed: 0 });
    }
    createdTrendRows.forEach((row: any) => {
      const target = trendMap.get(row.month);
      if (target) target.created = Number(row.count);
    });
    closedTrendRows.forEach((row: any) => {
      const target = trendMap.get(row.month);
      if (target) target.closed = Number(row.count);
    });

    const qualificationRaw = qualificationRows[0] as any;
    const qualificationStatus = qualificationRaw
      ? Object.fromEntries(Object.entries(qualificationRaw).map(([key, value]) => [key, Number(value)]))
      : { total: 0, valid: 0, expiring: 0, expired: 0, missing: 0 };

    return {
      summary: {
        tasks: taskTotal,
        templates,
        completed: (taskStatusMap[TaskStatus.PENDING_CLOSURE] || 0) + (taskStatusMap[TaskStatus.CLOSED] || 0),
        activeTasks: Object.entries(taskStatusMap)
          .filter(([status]) => ![TaskStatus.PREPARING, TaskStatus.PENDING_CLOSURE, TaskStatus.CLOSED, TaskStatus.CANCELLED].includes(status as TaskStatus))
          .reduce((sum, [, value]) => sum + value, 0),
        risks: riskTotal,
        highRisks,
        unresolvedRisks,
        overdueActions,
        assessmentCompletionRate: evaluationTotal ? Math.round(evaluationReviewed / evaluationTotal * 10000) / 100 : 0,
        qualifications: qualificationStatus.total,
        openFindings,
        workItems: workItems.counts,
      },
      taskPie: [
        ['准备中', TaskStatus.PREPARING, '#8E8E93'],
        ['待开始', TaskStatus.READY, '#007AFF'],
        ['进行中', TaskStatus.IN_PROGRESS, '#5856D6'],
        ['待复核', TaskStatus.PENDING_REVIEW, '#AF52DE'],
        ['待闭环', TaskStatus.PENDING_CLOSURE, '#FF9500'],
        ['已关闭', TaskStatus.CLOSED, '#248A3D'],
      ].map(([name, status, color]) => ({ name, value: taskStatusMap[status] || 0, color })),
      riskPie: [
        { name: '严重风险', value: riskLevelMap.critical || 0, color: '#8B0000' },
        { name: '高风险', value: riskLevelMap.high || 0, color: '#FF3B30' },
        { name: '中风险', value: riskLevelMap.medium || 0, color: '#FF9500' },
        { name: '低风险', value: riskLevelMap.low || 0, color: '#34C759' },
      ],
      riskTrend: [...trendMap.values()],
      qualificationStatus,
    };
  }
}

export default new ReportingService();
