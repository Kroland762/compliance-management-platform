import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import settingsService from '../services/settings.service';

const router = Router();
router.use(authenticate);

/**
 * GET /api/settings/security
 * 获取安全设置（所有登录用户可读，用于前端读取空闲超时等）
 */
router.get('/security', async (_req: Request, res: Response) => {
  try {
    const settings = await settingsService.getSecuritySettings();
    res.json({ success: true, data: settings });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * PUT /api/settings/security
 * 更新安全设置（仅管理员）
 */
router.put('/security', authorize('settings', 'update'), async (req: Request, res: Response) => {
  try {
    const settings = await settingsService.updateSecuritySettings(req.body, req.user!.userId);
    res.json({ success: true, data: settings });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

export default router;
