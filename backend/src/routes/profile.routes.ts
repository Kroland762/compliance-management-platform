import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import authService from '../services/auth.service';
import bcrypt from 'bcrypt';
import { User } from '../models';

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
    if (newPassword.length < 8) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: '新密码长度不能少于8位' } });
      return;
    }

    const user = await User.findByPk(req.user!.userId);
    if (!user) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '用户不存在' } });
      return;
    }

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      res.status(400).json({ success: false, error: { code: 'WRONG_PASSWORD', message: '当前密码错误' } });
      return;
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ success: true, message: '密码修改成功' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

export default router;
