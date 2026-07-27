import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import auditLogService from '../services/audit-log.service';
import objectAccessService from '../services/object-access.service';
import { asyncHandler } from '../utils/http';

const router = Router();
router.use(authenticate);
router.use(authorize('audit_logs', 'read'));

router.get('/', asyncHandler(async (req, res) => {
  const result = await auditLogService.queryLogs(
    req.query as any,
    await objectAccessService.auditScope(req.user!, 'read'),
  );
  res.json({ success: true, data: result });
}));

export default router;
