import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import reviewService from '../services/review.service';

const router = Router();
router.use(authenticate);
router.use(authorize('tasks', 'update'));

router.get('/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const data = await reviewService.getReviewData(req.params.taskId);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

router.put('/questions/:id', async (req: Request, res: Response) => {
  try {
    const item = await reviewService.saveReview(req.params.id, req.body);
    res.json({ success: true, data: item });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

export default router;
