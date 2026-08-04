import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../middlewares/auth';
import questionnaireService from '../services/questionnaire.service';
import { config } from '../config';
import { AppError, asyncHandler } from '../utils/http';
import objectAccessService from '../services/object-access.service';
import auditLogService from '../services/audit-log.service';
import { EvidenceType, OperationType } from '../models';
import { uploadOperations } from '../services/metrics.service';
import {
  getPreviewKind,
  getSafeContentType,
  readCsvPreview,
  resolveEvidencePath,
} from '../services/evidence-preview.service';

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
    operationDetails: '证据上传失败',
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

async function assertCanAccessQuestion(req: Request, questionItemId: string, operatorOnly = false) {
  return objectAccessService.questionOrNotFound(questionItemId, req.user!, operatorOnly);
}

async function assertCanAccessEvidence(req: Request, evidenceId: string, write = false) {
  const { EvidenceFile } = await import('../models');
  const evidence = await EvidenceFile.findOne({ where: { id: evidenceId, status: 'active' } });
  if (!evidence) throw new AppError(404, 'NOT_FOUND', '文件不存在');
  if (!evidence.questionItemId) throw new AppError(404, 'NOT_FOUND', '文件不存在');

  const item = await assertCanAccessQuestion(req, evidence.questionItemId, write);
  if (write && evidence.uploadedBy !== req.user!.userId && !objectAccessService.canReadAllTasks(req.user!)) {
    throw new AppError(404, 'NOT_FOUND', '文件不存在');
  }
  return { evidence, item };
}

// 获取任务的所有问题
router.get('/tasks/:taskId/questions', authorize('tasks', 'read'), asyncHandler(async (req: Request, res: Response) => {
  await objectAccessService.taskOrNotFound(req.params.taskId, req.user!);
  const questions = await questionnaireService.getQuestions(req.params.taskId, req.user!);
  res.json({ success: true, data: { questions } });
}));

// 保存问题答案
router.put('/questions/:id/answer', authorize('tasks', 'update'), asyncHandler(async (req: Request, res: Response) => {
  throw new AppError(
    410,
    'LEGACY_WRITE_PATH_DISABLED',
    '旧问卷写入接口已停用，请使用 /api/evaluations/:id/answer',
  );
}));

// 上传证据文件
router.post('/questions/:id/evidence', authorize('tasks', 'update'), evidenceUpload, asyncHandler(async (req: Request, res: Response) => {
  try {
    await assertCanAccessQuestion(req, req.params.id, true);
    if (!req.file) {
      res.status(400).json({ success: false, error: { code: 'NO_FILE', message: '请上传文件' } });
      return;
    }
    const evidence = await questionnaireService.uploadEvidence(
      req.params.id,
      req.file,
      req.user!.userId,
      req.tenant!.id,
      EvidenceType.CURRENT,
    );
    uploadOperations.inc({ outcome: 'success' });
    res.status(201).json({ success: true, data: evidence });
  } catch (error: any) {
    await auditUploadFailure(req);
    if (error instanceof AppError) throw error;
    res.status(400).json({ success: false, error: { code: 'UPLOAD_FAILED', message: error.message } });
  }
}));

// 删除证据
router.delete('/evidence/:id', authorize('tasks', 'update'), asyncHandler(async (req: Request, res: Response) => {
  try {
    await assertCanAccessEvidence(req, req.params.id, true);
    await questionnaireService.deleteEvidence(req.params.id, req.user!.userId);
    res.json({ success: true, message: '证据已删除' });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    res.status(400).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
}));

// 图片/PDF 在线预览内容
router.get('/evidence/:id/content', authorize('tasks', 'read'), asyncHandler(async (req: Request, res: Response) => {
  const { evidence } = await assertCanAccessEvidence(req, req.params.id);
  const kind = getPreviewKind(evidence.originalFilename, evidence.mimeType);
  const contentType = getSafeContentType(evidence.originalFilename, evidence.mimeType);
  if (!contentType || (kind !== 'image' && kind !== 'pdf')) {
    throw new AppError(415, 'PREVIEW_UNSUPPORTED', '该文件格式不支持二进制在线预览');
  }
  const target = resolveEvidencePath(evidence);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(evidence.originalFilename)}`);
  res.sendFile(target);
}));

// CSV 结构化分页预览
router.get('/evidence/:id/preview', authorize('tasks', 'read'), asyncHandler(async (req: Request, res: Response) => {
  const { evidence } = await assertCanAccessEvidence(req, req.params.id);
  if (getPreviewKind(evidence.originalFilename, evidence.mimeType) !== 'csv') {
    throw new AppError(415, 'PREVIEW_UNSUPPORTED', '该文件格式不支持结构化预览');
  }
  const page = Number(req.query.page || 1);
  const pageSize = Number(req.query.pageSize || 50);
  res.json({ success: true, data: await readCsvPreview(evidence, page, pageSize) });
}));

// 下载证据
router.get('/evidence/:id/download', authorize('tasks', 'read'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { evidence } = await assertCanAccessEvidence(req, req.params.id);
    const target = resolveEvidencePath(evidence);
    await auditLogService.log({
      userId: req.user!.userId,
      operationType: OperationType.QUERY,
      resourceType: 'evidence',
      resourceId: evidence.id,
      operationDetails: '下载证据文件',
      success: true,
    });
    res.download(target, evidence.originalFilename);
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    res.status(500).json({ success: false, error: { code: 'DOWNLOAD_FAILED', message: error.message } });
  }
}));

// 查看历史证据
router.get('/questions/:id/historical-evidence', authorize('tasks', 'read'), asyncHandler(async (req: Request, res: Response) => {
  try {
    await assertCanAccessQuestion(req, req.params.id);
    const evidence = await questionnaireService.getHistoricalEvidence(req.params.id);
    res.json({ success: true, data: evidence });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
}));

// 上传历史证据文件（配置任务时使用）
router.post('/questions/:id/historical-evidence', authorize('tasks', 'update'), evidenceUpload, asyncHandler(async (req: Request, res: Response) => {
  try {
    const item = await assertCanAccessQuestion(req, req.params.id, true);
    if (!req.file) {
      res.status(400).json({ success: false, error: { code: 'NO_FILE', message: '请上传文件' } });
      return;
    }
    const evidence = await questionnaireService.uploadEvidence(
      item.id,
      req.file,
      req.user!.userId,
      req.tenant!.id,
      EvidenceType.HISTORICAL,
    );
    uploadOperations.inc({ outcome: 'success' });
    res.status(201).json({
      success: true,
      data: evidence,
    });
  } catch (error: any) {
    await auditUploadFailure(req);
    if (error instanceof AppError) throw error;
    res.status(400).json({ success: false, error: { code: 'UPLOAD_FAILED', message: error.message } });
  }
}));

// 删除历史证据
router.delete('/questions/:id/historical-evidence', authorize('tasks', 'update'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const item = await assertCanAccessQuestion(req, req.params.id, true);
    const { EvidenceFile } = await import('../models');
    const evidence = await EvidenceFile.findOne({
      where: { questionItemId: item.id, evidenceType: 'historical', status: 'active' },
    });
    if (evidence) {
      await questionnaireService.deleteEvidence(evidence.id, req.user!.userId);
    }
    res.json({ success: true, message: '历史证据已删除' });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    res.status(400).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
}));

export default router;
