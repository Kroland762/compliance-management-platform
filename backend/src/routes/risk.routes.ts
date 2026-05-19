import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import riskService from '../services/risk.service';

const router = Router();
router.use(authenticate);
router.use(authorize('risks', 'read'));

router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await riskService.getRisks(req.query as any);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const risk = await riskService.createRisk(req.body, req.user!.userId);
    res.status(201).json({ success: true, data: risk });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'CREATE_FAILED', message: error.message } });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const risk = await riskService.updateRisk(req.params.id, req.body, req.user!.userId);
    res.json({ success: true, data: risk });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await riskService.deleteRisk(req.params.id, req.user!.userId);
    res.json({ success: true, message: '风险记录已删除' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
});

export default router;
