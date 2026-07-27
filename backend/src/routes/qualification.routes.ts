import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import qualificationService from '../services/qualification.service';

const router = Router();
router.use(authenticate);

router.get('/', authorize('qualifications', 'read'), async (req: Request, res: Response) => {
  try {
    const result = await qualificationService.list(req.query as any);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

router.post('/', authorize('qualifications', 'create'), async (req: Request, res: Response) => {
  try {
    const qualification = await qualificationService.create(req.body, req.user!.userId);
    res.status(201).json({ success: true, data: qualification });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'CREATE_FAILED', message: error.message } });
  }
});

router.put('/:id', authorize('qualifications', 'update'), async (req: Request, res: Response) => {
  try {
    const qualification = await qualificationService.update(req.params.id, req.body, req.user!.userId);
    res.json({ success: true, data: qualification });
  } catch (error: any) {
    const status = error.message === '资质记录不存在' ? 404 : 400;
    res.status(status).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

router.delete('/:id', authorize('qualifications', 'delete'), async (req: Request, res: Response) => {
  try {
    await qualificationService.delete(req.params.id, req.user!.userId);
    res.json({ success: true, message: '资质记录已删除' });
  } catch (error: any) {
    const status = error.message === '资质记录不存在' ? 404 : 400;
    res.status(status).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
});

export default router;
