import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import authService from '../services/auth.service';

const router = Router();
router.use(authenticate);

/**
 * PUT /api/profile/password — 修改密码
 */
router.put('/password', async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: '当前密码和新密码为必填项' } });
      return;
    }
    await authService.changePassword(req.user!.userId, currentPassword, newPassword);

    res.json({ success: true, message: '密码修改成功' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

export default router;
