import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import { OperationType } from '../models';
import auditLogService from '../services/audit-log.service';
import exportService from '../services/export.service';
import { fileStorage } from '../services/file-storage.service';
import idempotencyService from '../services/idempotency.service';
import objectAccessService from '../services/object-access.service';
import { AppError, asyncHandler } from '../utils/http';

const router = Router();
router.use(authenticate);
router.use(authorize('export', 'create'));

async function deliverExport(
  req: Request,
  res: Response,
  operation: string,
  resourceType: string,
  resourceId: string | null,
  filename: string,
  generate: () => Promise<Buffer>,
): Promise<void> {
  const idempotencyKey = idempotencyService.requireKey(req.header('Idempotency-Key'));
  let createdStorageKey: string | null = null;
  try {
    const result = await idempotencyService.execute(
      operation,
      idempotencyKey,
      req.user!.userId,
      { resourceId, query: req.query },
      async (transaction) => {
        const buffer = await generate();
        createdStorageKey = `tenants/${req.tenant!.id}/exports/${randomUUID()}.xlsx`;
        await fileStorage.put(createdStorageKey, buffer);
        await auditLogService.log({
          userId: req.user!.userId,
          operationType: OperationType.QUERY,
          resourceType,
          resourceId,
          operationDetails: `导出报告 ${filename}`,
          success: true,
        }, transaction);
        return { storageKey: createdStorageKey, filename };
      },
    );
    const storageKey = String(result.value.storageKey);
    if (!(await fileStorage.exists(storageKey))) {
      throw new AppError(410, 'EXPORT_EXPIRED', '导出文件已过期，请使用新的 Idempotency-Key 重试');
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.download(fileStorage.absolutePath(storageKey), String(result.value.filename));
  } catch (error) {
    if (createdStorageKey) await fileStorage.delete(createdStorageKey).catch(() => undefined);
    throw error;
  }
}

router.get('/tasks/:id', asyncHandler(async (req: Request, res: Response) => {
  await objectAccessService.taskOrNotFound(req.params.id, req.user!);
  await deliverExport(
    req,
    res,
    'export.task',
    'task',
    req.params.id,
    `audit-task-${req.params.id}.xlsx`,
    () => exportService.exportAuditTask(req.params.id, req.user!.username),
  );
}));

router.get('/risks', asyncHandler(async (req: Request, res: Response) => {
  const riskAccessWhere = await objectAccessService.riskScope(req.user!);
  await deliverExport(
    req,
    res,
    'export.risks',
    'risk_report',
    null,
    'risk-summary.xlsx',
    () => exportService.exportRisks(req.query, riskAccessWhere, {
      tenantName: req.tenant!.name,
      exportedBy: req.user!.username,
    }),
  );
}));

export default router;
