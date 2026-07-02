import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate } from '../middlewares/auth';
import questionnaireService from '../services/questionnaire.service';
import { config } from '../config';
import { AppError, asyncHandler } from '../utils/http';

const upload = multer({
  storage: multer.diskStorage({
    destination: path.resolve(config.upload.dir),
    filename: (_req, file, cb) => {
      // 修复中文文件名乱码：multer/busboy 用 latin1 编码非 ASCII 字符
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const unique = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
      cb(null, `${unique}-${originalName}`);
    },
  }),
  limits: { fileSize: config.upload.maxFileSize },
});

const router = Router();
router.use(authenticate);

function canOperateQuestion(req: Request): boolean {
  const taskPermissions = req.user?.permissions?.tasks || [];
  return taskPermissions.includes('create') || taskPermissions.includes('return') || taskPermissions.includes('delete');
}

async function getQuestionItemOrThrow(id: string) {
  const { QuestionItem } = await import('../models');
  const item = await QuestionItem.findByPk(id);
  if (!item) throw new AppError(404, 'NOT_FOUND', '问卷条目不存在');
  return item;
}

async function assertCanAccessQuestion(req: Request, questionItemId: string, operatorOnly = false) {
  const item = await getQuestionItemOrThrow(questionItemId);
  const isOperator = canOperateQuestion(req);
  if (operatorOnly && !isOperator) {
    throw new AppError(403, 'FORBIDDEN', '无权操作该问卷条目');
  }
  if (!isOperator && item.assignedTo !== req.user!.userId) {
    throw new AppError(403, 'FORBIDDEN', '无权访问该问卷条目');
  }
  return item;
}

async function assertCanAccessEvidence(req: Request, evidenceId: string, write = false) {
  const { EvidenceFile } = await import('../models');
  const evidence = await EvidenceFile.findByPk(evidenceId);
  if (!evidence) throw new AppError(404, 'NOT_FOUND', '文件不存在');

  const item = await assertCanAccessQuestion(req, evidence.questionItemId);
  const isOperator = canOperateQuestion(req);
  if (write && !isOperator && evidence.uploadedBy !== req.user!.userId) {
    throw new AppError(403, 'FORBIDDEN', '无权操作该证据文件');
  }
  return { evidence, item };
}

// 获取任务的所有问题
router.get('/tasks/:taskId/questions', async (req: Request, res: Response) => {
  try {
    const questions = await questionnaireService.getQuestions(req.params.taskId, req.user!.userId);
    res.json({ success: true, data: { questions } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

// 保存问题答案
router.put('/questions/:id/answer', asyncHandler(async (req: Request, res: Response) => {
  try {
    await assertCanAccessQuestion(req, req.params.id);
    const { currentStatusDescription } = req.body;
    const item = await questionnaireService.saveAnswer(req.params.id, currentStatusDescription || '');
    res.json({ success: true, data: item });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    res.status(400).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
}));

// 上传证据文件
router.post('/questions/:id/evidence', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  try {
    await assertCanAccessQuestion(req, req.params.id);
    if (!req.file) {
      res.status(400).json({ success: false, error: { code: 'NO_FILE', message: '请上传文件' } });
      return;
    }
    const evidence = await questionnaireService.uploadEvidence(req.params.id, req.file, req.user!.userId);
    res.status(201).json({ success: true, data: evidence });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    res.status(400).json({ success: false, error: { code: 'UPLOAD_FAILED', message: error.message } });
  }
}));

// 删除证据
router.delete('/evidence/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    await assertCanAccessEvidence(req, req.params.id, true);
    await questionnaireService.deleteEvidence(req.params.id);
    res.json({ success: true, message: '证据已删除' });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    res.status(400).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
}));

// 下载证据
router.get('/evidence/:id/download', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { evidence } = await assertCanAccessEvidence(req, req.params.id);
    res.download(evidence.filePath, evidence.originalFilename);
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    res.status(500).json({ success: false, error: { code: 'DOWNLOAD_FAILED', message: error.message } });
  }
}));

// 查看历史证据
router.get('/questions/:id/historical-evidence', asyncHandler(async (req: Request, res: Response) => {
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
router.post('/questions/:id/historical-evidence', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const item = await assertCanAccessQuestion(req, req.params.id, true);
    if (!req.file) {
      res.status(400).json({ success: false, error: { code: 'NO_FILE', message: '请上传文件' } });
      return;
    }
    item.historicalEvidencePath = req.file.path;
    await item.save();
    res.status(201).json({
      success: true,
      data: { path: req.file.path, filename: req.file.originalname, questionId: req.params.id },
    });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    res.status(400).json({ success: false, error: { code: 'UPLOAD_FAILED', message: error.message } });
  }
}));

// 删除历史证据
router.delete('/questions/:id/historical-evidence', asyncHandler(async (req: Request, res: Response) => {
  try {
    const fs = await import('fs');
    const item = await assertCanAccessQuestion(req, req.params.id, true);
    if (item.historicalEvidencePath) {
      fs.unlink(item.historicalEvidencePath, () => {});
      item.historicalEvidencePath = null;
      await item.save();
    }
    res.json({ success: true, message: '历史证据已删除' });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    res.status(400).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
}));

export default router;
