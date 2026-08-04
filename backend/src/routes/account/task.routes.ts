import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../../middlewares/auth';
import auditTaskService from '../../services/account/auditTask.service';

const router = Router();
router.use(authenticate);

function tenantContext(req: Request) {
  return { tenantId: req.tenant?.id || null, schemaName: req.tenant?.schemaName || 'public' };
}

// 所有任务操作需要 ADMIN 或 AUDITOR 权限
router.use(authorize('account_tasks', 'read'));

/**
 * GET /api/account/tasks
 * 列表查询
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await auditTaskService.listTasks(req.query as any);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * GET /api/account/tasks/:id
 * 详情
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await auditTaskService.getTask(req.params.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.message === '审计任务不存在' ? 404 : 500;
    res.status(status).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * POST /api/account/tasks
 * 创建任务 - ADMIN only
 */
router.post('/', authorize('account_tasks', 'create'), async (req: Request, res: Response) => {
  try {
    const result = await auditTaskService.createTask(req.body, req.user!.userId, tenantContext(req));
    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'CREATE_FAILED', message: error.message } });
  }
});

/**
 * PUT /api/account/tasks/:id
 * 更新任务 - ADMIN only
 */
router.put('/:id', authorize('account_tasks', 'update'), async (req: Request, res: Response) => {
  try {
    const result = await auditTaskService.updateTask(req.params.id, req.body, req.user!.userId, tenantContext(req));
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.message === '审计任务不存在' ? 404 : 400;
    res.status(status).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

/**
 * DELETE /api/account/tasks/:id
 * 删除任务 - ADMIN only
 */
router.delete('/:id', authorize('account_tasks', 'delete'), async (req: Request, res: Response) => {
  try {
    await auditTaskService.deleteTask(req.params.id, req.user!.userId, tenantContext(req));
    res.json({ success: true, message: '审计任务已删除' });
  } catch (error: any) {
    const status = error.message === '审计任务不存在' ? 404 : 400;
    res.status(status).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
});

/**
 * POST /api/account/tasks/:id/execute
 * 执行任务 - ADMIN & AUDITOR
 */
router.post('/:id/execute', authorize('account_tasks', 'execute'), async (req: Request, res: Response) => {
  try {
    const header = req.header('Idempotency-Key');
    const idempotencyKey = header ? `manual:${req.params.id}:${header.trim().slice(0, 120)}` : undefined;
    const result = await auditTaskService.executeTask(req.params.id, req.user!.userId, idempotencyKey);
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.message === '审计任务不存在' ? 404 : 400;
    res.status(status).json({ success: false, error: { code: 'EXECUTE_FAILED', message: error.message } });
  }
});

/**
 * GET /api/account/tasks/:id/executions
 * 执行历史
 */
router.get('/:id/executions', async (req: Request, res: Response) => {
  try {
    const result = await auditTaskService.getExecutionHistory(req.params.id, req.query as any);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

export default router;
