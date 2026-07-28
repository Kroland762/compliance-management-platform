import { Router } from 'express';
import { Op } from 'sequelize';
import { authenticate, authorize } from '../middlewares/auth';
import { AuditTask, Qualification, QuestionnaireTemplate, RiskRecord, TaskStatus } from '../models';
import objectAccessService from '../services/object-access.service';
import { asyncHandler } from '../utils/http';

const router = Router();
router.use(authenticate, authorize('dashboard', 'read'));

router.get('/', asyncHandler(async (req, res) => {
  const can = (resource: string, action: string) =>
    (req.user!.permissions as Record<string, string[] | undefined>)[resource]?.includes(action) === true;
  const taskWhere = await objectAccessService.taskScope(req.user!);
  const taskStats = await AuditTask.findAll({
    where: taskWhere,
    attributes: ['status', [AuditTask.sequelize!.fn('COUNT', AuditTask.sequelize!.col('id')), 'count']],
    group: ['status'],
    raw: true,
  });
  const taskStatusMap: Record<string, number> = {};
  taskStats.forEach((row: any) => { taskStatusMap[row.status] = Number(row.count); });

  const canReadAllTasks = objectAccessService.canReadAllTasks(req.user!);
  const taskIds = canReadAllTasks
    ? null
    : (await AuditTask.findAll({ where: taskWhere, attributes: ['id'], raw: true }))
      .map((row: any) => row.id);
  const riskStats = can('risks', 'read') && (taskIds === null || taskIds.length > 0)
    ? await RiskRecord.findAll({
      where: taskIds === null ? {} : { taskId: { [Op.in]: taskIds } },
      attributes: ['riskLevel', [RiskRecord.sequelize!.fn('COUNT', RiskRecord.sequelize!.col('id')), 'count']],
      group: ['riskLevel'],
      raw: true,
    })
    : [];
  const riskLevelMap: Record<string, number> = {};
  riskStats.forEach((row: any) => { riskLevelMap[row.riskLevel] = Number(row.count); });

  const emptyQualificationStatus = { total: 0, valid: 0, expiring: 0, expired: 0, missing: 0 };
  const qualificationWhere = can('qualifications', 'read')
    ? await objectAccessService.qualificationScope(req.user!)
    : null;
  const [qualificationRows, templates] = await Promise.all([
    qualificationWhere
      ? Qualification.findAll({
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
      })
      : Promise.resolve([]),
    can('templates', 'read') ? QuestionnaireTemplate.count() : 0,
  ]);
  const rawQualificationStatus = qualificationRows[0] as any;
  const qualificationStatus = rawQualificationStatus
    ? Object.fromEntries(Object.entries(rawQualificationStatus).map(([key, value]) => [key, Number(value)]))
    : emptyQualificationStatus;
  const taskTotal = Object.values(taskStatusMap).reduce((sum, value) => sum + value, 0);

  const taskPie = [
    ['草稿', TaskStatus.DRAFT, '#AEAEB2'],
    ['已分配', TaskStatus.ASSIGNED, '#007AFF'],
    ['进行中', TaskStatus.IN_PROGRESS, '#5856D6'],
    ['已提交', TaskStatus.SUBMITTED, '#FF9500'],
    ['审阅中', TaskStatus.UNDER_REVIEW, '#AF52DE'],
    ['已完成', TaskStatus.COMPLETED, '#34C759'],
    ['已退回', TaskStatus.RETURNED, '#FF3B30'],
  ].map(([name, status, color]) => ({ name, value: taskStatusMap[status] || 0, color }));

  const riskPie = [
    { name: '高风险', value: riskLevelMap.high || 0, color: '#FF3B30' },
    { name: '中风险', value: riskLevelMap.medium || 0, color: '#FF9500' },
    { name: '低风险', value: riskLevelMap.low || 0, color: '#34C759' },
  ];

  res.json({
    success: true,
    data: {
      summary: {
        tasks: taskTotal,
        templates,
        completed: taskStatusMap[TaskStatus.COMPLETED] || 0,
        activeTasks: Object.entries(taskStatusMap)
          .filter(([status]) => ![TaskStatus.COMPLETED, TaskStatus.DRAFT].includes(status as TaskStatus))
          .reduce((sum, [, value]) => sum + value, 0),
        risks: Object.values(riskLevelMap).reduce((sum, value) => sum + value, 0),
        qualifications: qualificationStatus.total,
      },
      taskPie,
      riskPie,
      qualificationStatus,
    },
  });
}));

export default router;
