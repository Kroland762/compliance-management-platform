import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { config } from '../config';
import { authenticate, authorize } from '../middlewares/auth';
import remediationService from '../services/remediation.service';
import { asyncHandler, AppError } from '../utils/http';
import { EvidenceFile, OperationType } from '../models';
import { fileStorage } from '../services/file-storage.service';
import objectAccessService from '../services/object-access.service';
import auditLogService from '../services/audit-log.service';
import { uploadOperations } from '../services/metrics.service';
import { parseExpectedLockVersion } from '../utils/optimistic-lock';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.upload.maxFileSize } });
const router = Router();
router.use(authenticate);

async function auditUploadFailure(req: Request) {
  uploadOperations.inc({ outcome: 'failure' });
  if (!req.user) return;
  await auditLogService.log({
    userId: req.user.userId,
    operationType: OperationType.CREATE,
    resourceType: 'evidence',
    resourceId: req.params.id || null,
    operationDetails: '整改行动证据上传失败',
    success: false,
    tenantId: req.tenant?.id,
  }).catch(() => undefined);
}

function evidenceUpload(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (error: any) => {
    if (!error) return next();
    void auditUploadFailure(req).finally(() => next(error));
  });
}

router.get('/', authorize('remediation_actions', 'read'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await remediationService.list(req.query, req.user!) });
}));

router.get('/:id', authorize('remediation_actions', 'read'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await remediationService.detail(req.params.id, req.user!) });
}));

router.post('/', authorize('remediation_actions', 'create'), asyncHandler(async (req: Request, res: Response) => {
  const action = await remediationService.create(req.body, req.user!);
  res.status(201).json({ success: true, data: action });
}));

router.put('/:id', authorize('remediation_actions', 'update'), asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: await remediationService.update(
      req.params.id,
      req.body,
      req.user!,
      parseExpectedLockVersion(req),
    ),
  });
}));

router.put('/:id/risks', authorize('remediation_actions', 'link'), asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: await remediationService.replaceRisks(
      req.params.id,
      req.body.riskLinks,
      req.user!,
      parseExpectedLockVersion(req),
    ),
  });
}));

router.post('/:id/evidence', authorize('remediation_actions', 'update'), evidenceUpload, asyncHandler(async (req: Request, res: Response) => {
  try {
    if (!req.file) throw new AppError(400, 'VALIDATION_ERROR', '请上传文件');
    const evidence = await remediationService.uploadEvidence(req.params.id, req.file, req.tenant!.id, req.user!);
    uploadOperations.inc({ outcome: 'success' });
    res.status(201).json({ success: true, data: evidence });
  } catch (error) {
    await auditUploadFailure(req);
    throw error;
  }
}));

router.get('/:id/evidence/:evidenceId/download', authorize('remediation_actions', 'read'), asyncHandler(async (req: Request, res: Response) => {
  const action = await objectAccessService.remediationOrNotFound(req.params.id, req.user!);
  const evidence = await EvidenceFile.findOne({
    where: { id: req.params.evidenceId, remediationActionId: req.params.id, status: 'active' },
  });
  if (!evidence?.storageKey) throw new AppError(404, 'NOT_FOUND', '证据不存在');
  if (!(await fileStorage.exists(evidence.storageKey))) {
    throw new AppError(404, 'NOT_FOUND', '证据文件不存在');
  }
  await auditLogService.log({
    userId: req.user!.userId,
    operationType: OperationType.QUERY,
    resourceType: 'evidence',
    resourceId: evidence.id,
    operationDetails: `下载整改行动 ${action.code} 的证据`,
    success: true,
    departmentId: action.ownerDepartmentId,
  });
  res.download(fileStorage.absolutePath(evidence.storageKey), evidence.originalFilename);
}));

router.delete('/:id/evidence/:evidenceId', authorize('remediation_actions', 'update'), asyncHandler(async (req: Request, res: Response) => {
  await remediationService.deleteEvidence(req.params.id, req.params.evidenceId, req.user!);
  res.status(204).send();
}));

router.post('/:id/submit', authorize('remediation_actions', 'submit'), asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: await remediationService.submit(
      req.params.id,
      req.user!,
      parseExpectedLockVersion(req),
      req.header('Idempotency-Key'),
    ),
  });
}));

export default router;
