import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../middlewares/auth';
import templateService from '../services/template.service';
import { isAllowedCsvFile } from '../utils/upload';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB for CSV
  fileFilter: (_req, file, cb) => {
    if (isAllowedCsvFile(file)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 CSV 文件'));
    }
  },
});

router.use(authenticate);

router.post('/import-preview', authorize('templates', 'create'), upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file?.buffer.length || req.file.buffer.includes(0)) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: '请上传有效的 CSV 文件' } });
      return;
    }
    res.json({ success: true, data: templateService.previewImport(req.file.buffer) });
  } catch (error: any) {
    res.status(error.status || 400).json({ success: false, error: { code: error.code || 'IMPORT_FAILED', message: error.message } });
  }
});

// 导入 CSV — admin only
router.post('/import', authorize('templates', 'create'), upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: { code: 'NO_FILE', message: '请上传 CSV 文件' } });
      return;
    }
    const { name, description, standardSeriesKey, version, controlKeyField } = req.body;
    if (!name) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: '模板名称为必填项' } });
      return;
    }
    const buffer = req.file.buffer;
    if (!buffer.length || buffer.includes(0)) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'CSV 文件签名或内容无效' } });
      return;
    }
    let columnSchema;
    if (req.body.columnSchema) {
      try { columnSchema = JSON.parse(req.body.columnSchema); } catch { throw new Error('列配置格式无效'); }
    }
    const result = await templateService.importTemplate(name, description, buffer, req.user!.userId, {
      standardSeriesKey,
      version,
      controlKeyField,
      columnSchema,
    });
    res.status(201).json({
      success: true,
      data: { templateId: result.template.id, importedCount: result.template.questionCount },
      message: `成功导入 ${result.template.questionCount} 个问题${result.extraNote}`,
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'IMPORT_FAILED', message: error.message } });
  }
});

router.put('/:id/columns', authorize('templates', 'update'), async (req: Request, res: Response) => {
  try {
    const data = await templateService.updateColumns(req.params.id, req.body.columns, req.user!.userId);
    res.json({ success: true, data, message: '评估表列配置已保存，后续发布的项目将使用新配置' });
  } catch (error: any) {
    res.status(error.status || 400).json({ success: false, error: { code: error.code || 'UPDATE_FAILED', message: error.message } });
  }
});

// 列表 — admin + auditor
router.get('/', authorize('templates', 'read'), async (req: Request, res: Response) => {
  try {
    const result = await templateService.getTemplates(req.query as any);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

// 详情 — admin + auditor
router.get('/:id', authorize('templates', 'read'), async (req: Request, res: Response) => {
  try {
    const template = await templateService.getTemplateById(req.params.id);
    res.json({ success: true, data: template });
  } catch (error: any) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: error.message } });
  }
});

// 删除 — admin only
router.delete('/:id', authorize('templates', 'delete'), async (req: Request, res: Response) => {
  try {
    await templateService.deleteTemplate(req.params.id, req.user!.userId);
    res.json({ success: true, message: '模板已删除' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
});

export default router;
