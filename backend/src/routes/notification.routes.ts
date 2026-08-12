import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import notificationService from '../services/notification.service';
import { AppError } from '../utils/http';

const router = Router();
router.use(authenticate);

router.get('/', authorize('notifications', 'read'), async (req: Request, res: Response) => {
  try {
    const result = await notificationService.getNotifications(req.user!.userId, req.query as any);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

router.get('/unread-count', authorize('notifications', 'read'), async (req: Request, res: Response) => {
  try {
    const count = await notificationService.getUnreadCount(req.user!.userId);
    res.json({ success: true, data: { count } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

router.put('/:id/read', authorize('notifications', 'update'), async (req: Request, res: Response) => {
  try {
    await notificationService.markAsRead(req.params.id, req.user!.userId);
    res.json({ success: true, message: '已标记为已读' });
  } catch (error: any) {
    const status = error instanceof AppError ? error.statusCode : 400;
    const code = error instanceof AppError ? error.code : 'UPDATE_FAILED';
    res.status(status).json({ success: false, error: { code, message: error.message } });
  }
});

export default router;
