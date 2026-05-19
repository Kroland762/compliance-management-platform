import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import auditLogService from '../services/audit-log.service';

const router = Router();
router.use(authenticate);
router.use(authorize('audit_logs', 'read'));

router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await auditLogService.queryLogs(req.query as any);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

export default router;
