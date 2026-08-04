import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { authenticate, authorize } from '../middlewares/auth';
import { requireObjectAccess } from '../middlewares/objectAccess';
import questionnaireService from '../services/questionnaire.service';
import { config } from '../config';
import { getPreviewKind, getSafeContentType, readCsvPreview } from '../services/evidence-preview.service';
import { assertEvidenceReadable } from '../services/evidence-security.service';
import auditLogService from '../services/audit-log.service';
import { OperationType } from '../models';

const uploadRoot = path.resolve(config.upload.dir);
fs.mkdirSync(uploadRoot, { recursive: true });

function resolveStoredEvidencePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  if (resolved !== uploadRoot && !resolved.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new Error('证据存储路径无效');
  }
  return resolved;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: path.resolve(config.upload.dir),
    filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: config.upload.maxFileSize },
});

const router = Router();
router.use(authenticate);

// 获取任务的所有问题
router.get('/tasks/:taskId/questions', authorize('tasks', 'read'), requireObjectAccess('task', 'taskId', 'read'), async (req: Request, res: Response) => {
  try {
    const questions = await questionnaireService.getQuestions(req.params.taskId, req.user!);
    res.json({ success: true, data: { questions } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

// 保存问题答案
router.put('/questions/:id/answer', authorize('tasks', 'update'), requireObjectAccess('question', 'id', 'respond'), async (req: Request, res: Response) => {
  try {
    const { currentStatusDescription } = req.body;
    const item = await questionnaireService.saveAnswer(req.params.id, currentStatusDescription || '');
    res.json({ success: true, data: item });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

// 上传证据文件
router.post('/questions/:id/evidence', authorize('tasks', 'update'), requireObjectAccess('question', 'id', 'respond'), upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: { code: 'NO_FILE', message: '请上传文件' } });
      return;
    }
    const evidence = await questionnaireService.uploadEvidence(req.params.id, req.file, req.user!.userId);
    res.status(201).json({ success: true, data: evidence });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'UPLOAD_FAILED', message: error.message } });
  }
});

// 删除证据
router.delete('/evidence/:id', authorize('tasks', 'update'), requireObjectAccess('evidence', 'id', 'respond'), async (req: Request, res: Response) => {
  try {
    await questionnaireService.deleteEvidence(req.params.id, req.user!.userId);
    res.json({ success: true, message: '证据已删除' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
});

// 下载证据
router.get('/evidence/:id/download', authorize('tasks', 'read'), requireObjectAccess('evidence', 'id', 'read'), async (req: Request, res: Response) => {
  try {
    const { EvidenceFile } = await import('../models');
    const evidence = await EvidenceFile.findByPk(req.params.id);
    if (!evidence) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '文件不存在' } });
      return;
    }
    assertEvidenceReadable(evidence);
    const filePath = resolveStoredEvidencePath(evidence.filePath);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: { code: 'FILE_MISSING', message: '文件不存在或已被移除' } });
      return;
    }
    res.setHeader('Cache-Control', 'private, no-store');
    await auditLogService.log({
      userId: req.user!.userId, operationType: OperationType.QUERY, resourceType: 'evidence_download',
      resourceId: evidence.id, operationDetails: `下载证据 v${evidence.version}`, success: true,
    });
    res.download(filePath, evidence.originalFilename);
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'DOWNLOAD_FAILED', message: error.message } });
  }
});

// 在线读取图片或 PDF 内容
router.get('/evidence/:id/content', authorize('tasks', 'read'), requireObjectAccess('evidence', 'id', 'read'), async (req: Request, res: Response) => {
  try {
    const { EvidenceFile } = await import('../models');
    const evidence = await EvidenceFile.findByPk(req.params.id);
    if (!evidence) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '文件不存在' } });
      return;
    }
    assertEvidenceReadable(evidence);
    const contentType = getSafeContentType(evidence.originalFilename, evidence.mimeType);
    if (!contentType) {
      res.status(415).json({ success: false, error: { code: 'PREVIEW_UNSUPPORTED', message: '该格式暂不支持在线预览' } });
      return;
    }
    const filePath = resolveStoredEvidencePath(evidence.filePath);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: { code: 'FILE_MISSING', message: '文件不存在或已被移除' } });
      return;
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="preview"; filename*=UTF-8''${encodeURIComponent(evidence.originalFilename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await auditLogService.log({
      userId: req.user!.userId, operationType: OperationType.QUERY, resourceType: 'evidence_preview',
      resourceId: evidence.id, operationDetails: `在线预览证据 v${evidence.version}`, success: true,
    });
    res.sendFile(filePath);
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'PREVIEW_FAILED', message: error.message } });
  }
});

// CSV 结构化预览（最多前 1000 行）
router.get('/evidence/:id/preview', authorize('tasks', 'read'), requireObjectAccess('evidence', 'id', 'read'), async (req: Request, res: Response) => {
  try {
    const { EvidenceFile } = await import('../models');
    const evidence = await EvidenceFile.findByPk(req.params.id);
    if (!evidence) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '文件不存在' } });
      return;
    }
    assertEvidenceReadable(evidence);
    resolveStoredEvidencePath(evidence.filePath);
    if (getPreviewKind(evidence.originalFilename, evidence.mimeType) !== 'csv') {
      res.status(415).json({ success: false, error: { code: 'PREVIEW_UNSUPPORTED', message: '该接口仅支持 CSV 文件' } });
      return;
    }
    const result = await readCsvPreview(evidence, Number(req.query.page), Number(req.query.pageSize));
    await auditLogService.log({
      userId: req.user!.userId, operationType: OperationType.QUERY, resourceType: 'evidence_preview',
      resourceId: evidence.id, operationDetails: `CSV预览证据 v${evidence.version}`, success: true,
    });
    res.json({ success: true, data: result });
  } catch (error: any) {
    const isMissing = error?.code === 'ENOENT';
    res.status(isMissing ? 404 : 400).json({
      success: false,
      error: {
        code: isMissing ? 'FILE_MISSING' : 'CSV_PREVIEW_FAILED',
        message: isMissing ? '文件不存在或已被移除' : error.message,
      },
    });
  }
});

// 查看历史证据
router.get('/questions/:id/historical-evidence', authorize('tasks', 'read'), requireObjectAccess('question', 'id', 'read'), async (req: Request, res: Response) => {
  try {
    const evidence = await questionnaireService.getHistoricalEvidence(req.params.id);
    res.json({ success: true, data: evidence });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

// 上传历史证据文件（配置任务时使用）
router.post('/questions/:id/historical-evidence', authorize('tasks', 'update'), requireObjectAccess('question', 'id', 'manage'), upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: { code: 'NO_FILE', message: '请上传文件' } });
      return;
    }
    const evidence = await questionnaireService.uploadHistoricalEvidence(req.params.id, req.file, req.user!.userId);
    res.status(201).json({ success: true, data: evidence });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'UPLOAD_FAILED', message: error.message } });
  }
});

// 删除历史证据
router.delete('/questions/:id/historical-evidence', authorize('tasks', 'update'), requireObjectAccess('question', 'id', 'manage'), async (req: Request, res: Response) => {
  try {
    await questionnaireService.deleteHistoricalEvidence(req.params.id, req.user!.userId);
    res.json({ success: true, message: '历史证据已删除' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
});

export default router;
