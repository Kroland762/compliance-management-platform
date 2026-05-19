import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../../middlewares/auth';
import problemService from '../../services/account/problem.service';

const router = Router();
router.use(authenticate);

// 问题查看对所有已认证用户开放，管理操作需要 AUDITOR 或 ADMIN
// 使用中间件组合实现灵活权限控制

/**
 * GET /api/account/problems
 * 列表查询 - 所有已认证用户
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await problemService.listProblems(req.query as any);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * GET /api/account/problems/stats
 * 统计信息 - 所有已认证用户
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const result = await problemService.getProblemStats(req.query.taskId as string);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * GET /api/account/problems/:id
 * 详情 - 所有已认证用户
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await problemService.getProblem(req.params.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.message === '问题记录不存在' ? 404 : 500;
    res.status(status).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * PATCH /api/account/problems/:id/status
 * 更新状态 - ADMIN & AUDITOR
 */
router.patch('/:id/status', authorize('problems', 'update'), async (req: Request, res: Response) => {
  try {
    const { status, notes } = req.body;
    if (!status) {
      res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '状态值不能为空' } });
      return;
    }
    const result = await problemService.updateStatus(req.params.id, status, req.user!.userId, notes);
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.message === '问题记录不存在' ? 404 : 400;
    res.status(status).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

/**
 * POST /api/account/problems/bulk-status
 * 批量更新状态 - ADMIN & AUDITOR
 */
router.post('/bulk-status', authorize('problems', 'update'), async (req: Request, res: Response) => {
  try {
    const { ids, status, notes } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '请提供有效的ID列表' } });
      return;
    }
    if (!status) {
      res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '状态值不能为空' } });
      return;
    }
    const result = await problemService.bulkUpdateStatus({ ids, status, notes }, req.user!.userId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

/**
 * GET /api/account/problems/export/data
 * 导出 - ADMIN & AUDITOR
 */
router.get('/export/data', authorize('problems', 'export'), async (req: Request, res: Response) => {
  try {
    const format = (req.query.format as string) || 'json';
    const result = await problemService.exportProblems(req.query as any, format as 'csv' | 'json');

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=problem-accounts-${Date.now()}.csv`);
      // Add BOM for Excel compatibility
      res.send('\uFEFF' + result);
    } else {
      res.json({ success: true, data: result });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'EXPORT_FAILED', message: error.message } });
  }
});

export default router;
