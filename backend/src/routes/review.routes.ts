import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import reviewService from '../services/review.service';
import objectAccessService from '../services/object-access.service';
import { AppError } from '../utils/http';

const router = Router();
router.use(authenticate);
router.use(authorize('tasks', 'update'));

router.get('/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    await objectAccessService.taskOrNotFound(req.params.taskId, req.user!);
    const data = await reviewService.getReviewData(req.params.taskId);
    res.json({ success: true, data });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

router.put('/questions/:id', async (req: Request, res: Response) => {
  res.status(410).json({
    success: false,
    error: {
      code: 'LEGACY_WRITE_PATH_DISABLED',
      message: '旧复核写入接口已停用，请使用 /api/evaluations/:id/review',
    },
  });
});

export default router;
