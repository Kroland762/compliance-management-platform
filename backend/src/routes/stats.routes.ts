import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import { AuditTask, RiskRecord } from '../models';
import { Op } from 'sequelize';

const router = Router();
router.use(authenticate);

router.get('/', async (_req: Request, res: Response) => {
  try {
    // 任务状态分布
    const taskStats = await AuditTask.findAll({
      attributes: ['status', [AuditTask.sequelize!.fn('COUNT', AuditTask.sequelize!.col('id')), 'count']],
      group: ['status'],
      raw: true,
    });

    const taskStatusMap: Record<string, number> = {};
    taskStats.forEach((r: any) => { taskStatusMap[r.status] = Number(r.count); });

    const taskPie = [
      { name: '草稿', value: taskStatusMap.draft || 0, color: '#AEAEB2' },
      { name: '已分配', value: taskStatusMap.assigned || 0, color: '#007AFF' },
      { name: '进行中', value: taskStatusMap.in_progress || 0, color: '#5856D6' },
      { name: '已提交', value: taskStatusMap.submitted || 0, color: '#FF9500' },
      { name: '审阅中', value: taskStatusMap.under_review || 0, color: '#AF52DE' },
      { name: '已完成', value: taskStatusMap.completed || 0, color: '#34C759' },
      { name: '已退回', value: taskStatusMap.returned || 0, color: '#FF3B30' },
    ];

    // 风险级别分布
    const riskStats = await RiskRecord.findAll({
      attributes: ['riskLevel', [RiskRecord.sequelize!.fn('COUNT', RiskRecord.sequelize!.col('id')), 'count']],
      group: ['riskLevel'],
      raw: true,
    });

    const riskLevelMap: Record<string, number> = {};
    riskStats.forEach((r: any) => { riskLevelMap[r.riskLevel] = Number(r.count); });

    const riskPie = [
      { name: '高风险', value: riskLevelMap.high || 0, color: '#FF3B30' },
      { name: '中风险', value: riskLevelMap.medium || 0, color: '#FF9500' },
      { name: '低风险', value: riskLevelMap.low || 0, color: '#34C759' },
    ];

    res.json({
      success: true,
      data: { taskPie, riskPie },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

export default router;
