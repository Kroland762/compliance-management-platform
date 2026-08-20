import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../../middlewares/auth';
import dashboardService from '../../services/account/dashboard.service';

const router = Router();
router.use(authenticate);
router.use(authorize('account_dashboard', 'read'));

/**
 * GET /api/account/dashboard/overview
 * 全局概览
 */
router.get('/overview', async (_req: Request, res: Response) => {
  try {
    const result = await dashboardService.getOverview();
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * GET /api/account/dashboard/trends
 * 趋势数据，?days=30
 */
router.get('/trends', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const result = await dashboardService.getTrends(days);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * GET /api/account/dashboard/risk-distribution
 * 风险分布
 */
router.get('/risk-distribution', async (_req: Request, res: Response) => {
  try {
    const result = await dashboardService.getRiskDistribution();
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * GET /api/account/dashboard/source-ranking
 * 数据源问题排名
 */
router.get('/source-ranking', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const result = await dashboardService.getSourceRanking(limit);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

export default router;
