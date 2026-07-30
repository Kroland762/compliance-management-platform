import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { config } from '../config';
import { authenticate, authorize } from '../middlewares/auth';
import evaluationService from '../services/evaluation.service';
import questionnaireService from '../services/questionnaire.service';
import objectAccessService from '../services/object-access.service';
import { asyncHandler, AppError } from '../utils/http';
import auditLogService from '../services/audit-log.service';
import { OperationType } from '../models';
import { uploadOperations } from '../services/metrics.service';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxFileSize },
});
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
    operationDetails: '评估单元证据上传失败',
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

router.get('/:id', authorize('evaluations', 'read'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await evaluationService.detail(req.params.id, req.user!) });
}));

router.put('/:id/answer', authorize('evaluations', 'answer'), asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: await evaluationService.answer(
      req.params.id,
      req.body.currentStatusDescription || '',
      req.body.lockVersion,
      req.user!,
    ),
  });
}));

router.post('/:id/evidence', authorize('evaluations', 'answer'), evidenceUpload, asyncHandler(async (req: Request, res: Response) => {
  try {
    await objectAccessService.evaluationOrNotFound(req.params.id, req.user!, 'answer');
    if (!req.file) throw new AppError(400, 'VALIDATION_ERROR', '请上传文件');
    const evidence = await questionnaireService.uploadEvidence(
      req.params.id,
      req.file,
      req.user!.userId,
      req.tenant!.id,
      'current',
    );
    uploadOperations.inc({ outcome: 'success' });
    res.status(201).json({ success: true, data: evidence });
  } catch (error) {
    await auditUploadFailure(req);
    throw error;
  }
}));

router.post('/:id/submit', authorize('evaluations', 'submit'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await evaluationService.submit(req.params.id, req.user!) });
}));

router.post('/:id/review', authorize('evaluations', 'review'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await evaluationService.review(req.params.id, req.body, req.user!) });
}));

export default router;
