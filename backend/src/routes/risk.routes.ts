import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import riskService from '../services/risk.service';
import objectAccessService from '../services/object-access.service';
import { AppError } from '../utils/http';

const router = Router();
router.use(authenticate);
router.use(authorize('risks', 'read'));

router.get('/', async (req: Request, res: Response) => {
  try {
    const taskIds = await objectAccessService.accessibleTaskIds(req.user!);
    const result = await riskService.getRisks({ ...req.query, taskIds } as any);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

router.post('/', authorize('risks', 'update'), async (req: Request, res: Response) => {
  try {
    if (!objectAccessService.canReadAllTasks(req.user!)) {
      throw new AppError(403, 'FORBIDDEN', '仅租户管理员可创建未关联任务的风险');
    }
    const risk = await riskService.createRisk(req.body, req.user!.userId);
    res.status(201).json({ success: true, data: risk });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }
    res.status(400).json({ success: false, error: { code: 'CREATE_FAILED', message: error.message } });
  }
});

router.put('/:id', authorize('risks', 'update'), async (req: Request, res: Response) => {
  try {
    await objectAccessService.riskOrNotFound(req.params.id, req.user!);
    const risk = await riskService.updateRisk(req.params.id, req.body, req.user!.userId);
    res.json({ success: true, data: risk });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }
    res.status(400).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

router.delete('/:id', authorize('risks', 'update'), async (req: Request, res: Response) => {
  try {
    await objectAccessService.riskOrNotFound(req.params.id, req.user!);
    await riskService.deleteRisk(req.params.id, req.user!.userId);
    res.json({ success: true, message: '风险记录已删除' });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }
    res.status(400).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
});

export default router;
