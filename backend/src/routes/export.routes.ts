import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import exportService from '../services/export.service';
import { requireObjectAccess } from '../middlewares/objectAccess';

const router = Router();
router.use(authenticate);
router.use(authorize('export', 'create'));

router.get('/tasks/:id', requireObjectAccess('task', 'id', 'read'), async (req: Request, res: Response) => {
  try {
    const buffer = await exportService.exportAuditTask(req.params.id, req.user!.username);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=audit-task-${req.params.id}.xlsx`);
    res.send(buffer);
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'EXPORT_FAILED', message: error.message } });
  }
});

router.get('/risks', async (req: Request, res: Response) => {
  try {
    const buffer = await exportService.exportRisks(req.query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=risk-summary.xlsx');
    res.send(buffer);
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'EXPORT_FAILED', message: error.message } });
  }
});

export default router;
