import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import exportService from '../services/export.service';
import objectAccessService from '../services/object-access.service';
import { AppError } from '../utils/http';

const router = Router();
router.use(authenticate);
router.use(authorize('export', 'create'));

router.get('/tasks/:id', async (req: Request, res: Response) => {
  try {
    await objectAccessService.taskOrNotFound(req.params.id, req.user!);
    const buffer = await exportService.exportAuditTask(req.params.id, req.user!.username);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=audit-task-${req.params.id}.xlsx`);
    res.send(buffer);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }
    res.status(400).json({ success: false, error: { code: 'EXPORT_FAILED', message: error.message } });
  }
});

router.get('/risks', async (req: Request, res: Response) => {
  try {
    const taskIds = await objectAccessService.accessibleTaskIds(req.user!);
    const buffer = await exportService.exportRisks(req.query, taskIds);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=risk-summary.xlsx');
    res.send(buffer);
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'EXPORT_FAILED', message: error.message } });
  }
});

export default router;
