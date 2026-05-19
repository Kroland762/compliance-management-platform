import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import notificationService from '../services/notification.service';

const router = Router();
router.use(authenticate);

router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await notificationService.getNotifications(req.user!.userId, req.query as any);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

router.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const count = await notificationService.getUnreadCount(req.user!.userId);
    res.json({ success: true, data: { count } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

router.put('/:id/read', async (req: Request, res: Response) => {
  try {
    await notificationService.markAsRead(req.params.id);
    res.json({ success: true, message: '已标记为已读' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

export default router;
