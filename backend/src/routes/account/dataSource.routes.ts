import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../../middlewares/auth';
import dataSourceService from '../../services/account/dataSource.service';
import { syncOperations } from '../../services/metrics.service';

const router = Router();
router.use(authenticate);

/**
 * GET /api/account/data-sources
 * 列表查询 - ADMIN & AUDITOR
 */
router.get('/', authorize('data_sources', 'read'), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.listDataSources(req.query as any);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * GET /api/account/data-sources/:id
 * 详情 - ADMIN & AUDITOR
 */
router.get('/:id', authorize('data_sources', 'read'), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.getDataSource(req.params.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.message === '数据源不存在' ? 404 : 500;
    res.status(status).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * POST /api/account/data-sources
 * 创建 - ADMIN only
 */
router.post('/', authorize('data_sources', 'create'), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.createDataSource(req.body, req.user!.userId);
    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'CREATE_FAILED', message: error.message } });
  }
});

/**
 * POST /api/account/data-sources/upload
 * CSV 文件上传创建 - ADMIN only
 */
router.post('/upload', authorize('data_sources', 'create'), (_req: Request, res: Response) => {
  res.status(400).json({
    success: false,
    error: { code: 'VALIDATION_ERROR', message: 'CSV 数据源已停用；请创建 PostgreSQL 只读数据源' },
  });
});

/**
 * POST /api/account/data-sources/preview-fields
 * 预览数据库字段名 - ADMIN only
 */
router.post('/preview-fields', authorize('data_sources', 'create'), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.previewDbFields(req.body);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'PREVIEW_FAILED', message: error.message } });
  }
});

/**
 * PUT /api/account/data-sources/:id
 * 更新 - ADMIN only
 */
router.put('/:id', authorize('data_sources', 'update'), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.updateDataSource(req.params.id, req.body, req.user!.userId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.message === '数据源不存在' ? 404 : 400;
    res.status(status).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

/**
 * PATCH /api/account/data-sources/:id/toggle
 * 启用/停用 - ADMIN only
 */
router.patch('/:id/toggle', authorize('data_sources', 'update'), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.toggleDataSource(req.params.id, req.user!.userId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.message === '数据源不存在' ? 404 : 400;
    res.status(status).json({ success: false, error: { code: 'TOGGLE_FAILED', message: error.message } });
  }
});

/**
 * DELETE /api/account/data-sources/:id
 * 删除 - ADMIN only
 */
router.delete('/:id', authorize('data_sources', 'delete'), async (req: Request, res: Response) => {
  try {
    await dataSourceService.deleteDataSource(req.params.id, req.user!.userId);
    res.json({ success: true, message: '数据源已删除' });
  } catch (error: any) {
    const status = error.message === '数据源不存在' ? 404 : 400;
    res.status(status).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
});

/**
 * POST /api/account/data-sources/:id/test-connection
 * 测试连接 - ADMIN only
 */
router.post('/:id/test-connection', authorize('data_sources', 'update'), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.testConnection(req.params.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'TEST_FAILED', message: error.message } });
  }
});

/**
 * GET /api/account/data-sources/:id/preview
 * 预览数据 - ADMIN & AUDITOR
 */
router.get('/:id/preview', authorize('data_sources', 'read'), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.previewData(req.params.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'PREVIEW_FAILED', message: error.message } });
  }
});

/**
 * POST /api/account/data-sources/:id/sync
 * 同步数据 - ADMIN only
 */
router.post('/:id/sync', authorize('data_sources', 'sync'), async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true';
    const result = await dataSourceService.syncData(req.params.id, req.user!.userId, force);
    syncOperations.inc({ outcome: 'success' });
    res.json({ success: true, data: result });
  } catch (error: any) {
    syncOperations.inc({ outcome: 'failure' });
    res.status(400).json({ success: false, error: { code: 'SYNC_FAILED', message: error.message } });
  }
});

/**
 * GET /api/account/data-sources/:id/account-changes
 * 账户变更统计 - ADMIN & AUDITOR
 */
router.get('/:id/account-changes', authorize('data_sources', 'read'), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.getAccountChangeStats(req.params.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'STATS_FAILED', message: error.message } });
  }
});

export default router;
