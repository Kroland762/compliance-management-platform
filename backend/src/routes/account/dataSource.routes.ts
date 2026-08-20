import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../../middlewares/auth';
import dataSourceService from '../../services/account/dataSource.service';
import csvDataSourceService, { CsvDataSourceError } from '../../services/account/csvDataSource.service';
import { syncOperations, uploadOperations } from '../../services/metrics.service';
import { validate } from '../../middlewares/validate';
import { dataSourceListQuery } from './validation';
import { isAllowedCsvFile } from '../../utils/upload';
import { DataSource } from '../../models/account';
import auditLogService from '../../services/audit-log.service';
import { OperationType } from '../../models';

const router = Router();
router.use(authenticate);

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (isAllowedCsvFile(file)) callback(null, true);
    else callback(new Error('仅支持 CSV 文件'));
  },
});

function csvError(res: Response, error: any, fallbackCode: string) {
  const status = error instanceof CsvDataSourceError ? error.status : 400;
  res.status(status).json({
    success: false,
    error: {
      code: error instanceof CsvDataSourceError ? error.code : fallbackCode,
      message: error.message,
      ...(error instanceof CsvDataSourceError && error.details ? { details: error.details } : {}),
    },
  });
}

async function auditCsvFailure(req: Request, operationType: OperationType, fallbackCode: string, error: any) {
  if (!req.user) return;
  await auditLogService.log({
    userId: req.user.userId,
    operationType,
    resourceType: 'data_source',
    resourceId: req.params.id || null,
    operationDetails: `CSV 操作失败: ${error instanceof CsvDataSourceError ? error.code : fallbackCode}`,
    success: false,
  }).catch(() => undefined);
}

function csvFile(operationType: OperationType) {
  return (req: Request, res: Response, next: NextFunction) => {
    csvUpload.single('file')(req, res, error => {
      if (!error) return next();
      uploadOperations.inc({ outcome: 'failure' });
      const csvUploadError = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
        ? new CsvDataSourceError('CSV 文件不能超过 50 MB', 'FILE_TOO_LARGE', 400)
        : new CsvDataSourceError(error.message || 'CSV 上传失败', 'INVALID_FILE', 400);
      void auditCsvFailure(req, operationType, csvUploadError.code, csvUploadError)
        .finally(() => csvError(res, csvUploadError, csvUploadError.code));
    });
  };
}

/**
 * GET /api/account/data-sources
 * 列表查询 - ADMIN & AUDITOR
 */
router.get('/', authorize('data_sources', 'read'), validate({ query: dataSourceListQuery }), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.listDataSources(req.query as any);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * GET /api/account/data-sources/:id
 * 详情 - ADMIN & AUDITOR
 */
router.get('/:id', authorize('data_sources', 'read'), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.getDataSource(req.params.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.message === '数据源不存在' ? 404 : 500;
    res.status(status).json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } });
  }
});

/**
 * POST /api/account/data-sources
 * 创建 - ADMIN only
 */
router.post('/', authorize('data_sources', 'create'), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.createDataSource(req.body, req.user!.userId);
    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'CREATE_FAILED', message: error.message } });
  }
});

/** Preview a new CSV data source without persisting the file or data. */
router.post('/csv/preview', authorize('data_sources', 'create'), csvFile(OperationType.CREATE), async (req: Request, res: Response) => {
  try {
    if (!req.file) throw new CsvDataSourceError('请上传 CSV 文件', 'NO_FILE');
    const result = await csvDataSourceService.preview(req.file, req.body.fieldMappingConfig, undefined, req.body.delimiter);
    uploadOperations.inc({ outcome: 'success' });
    res.json({ success: true, data: result });
  } catch (error: any) {
    uploadOperations.inc({ outcome: 'failure' });
    await auditCsvFailure(req, OperationType.CREATE, 'PREVIEW_FAILED', error);
    csvError(res, error, 'PREVIEW_FAILED');
  }
});

/**
 * POST /api/account/data-sources/upload
 * CSV 文件上传创建 - ADMIN only
 */
router.post('/upload', authorize('data_sources', 'create'), csvFile(OperationType.CREATE), async (req: Request, res: Response) => {
  try {
    if (!req.file) throw new CsvDataSourceError('请上传 CSV 文件', 'NO_FILE');
    const result = await csvDataSourceService.createAndImport(req.file, req.body, req.user!.userId);
    uploadOperations.inc({ outcome: 'success' });
    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    uploadOperations.inc({ outcome: 'failure' });
    await auditCsvFailure(req, OperationType.CREATE, 'CREATE_FAILED', error);
    csvError(res, error, 'CREATE_FAILED');
  }
});

/** Preview a replacement CSV using the mapping saved on this system. */
router.post('/:id/csv/preview', authorize('data_sources', 'sync'), csvFile(OperationType.UPDATE), async (req: Request, res: Response) => {
  try {
    if (!req.file) throw new CsvDataSourceError('请上传 CSV 文件', 'NO_FILE');
    const result = await csvDataSourceService.preview(req.file, req.body.fieldMappingConfig, req.params.id, req.body.delimiter);
    uploadOperations.inc({ outcome: 'success' });
    res.json({ success: true, data: result });
  } catch (error: any) {
    uploadOperations.inc({ outcome: 'failure' });
    await auditCsvFailure(req, OperationType.UPDATE, 'PREVIEW_FAILED', error);
    csvError(res, error, 'PREVIEW_FAILED');
  }
});

/** Replace a CSV system's current batch while preserving its stable data source id. */
router.post('/:id/upload', authorize('data_sources', 'sync'), csvFile(OperationType.UPDATE), async (req: Request, res: Response) => {
  try {
    if (!req.file) throw new CsvDataSourceError('请上传 CSV 文件', 'NO_FILE');
    if (req.body.fieldMappingConfig !== undefined) {
      const source = await DataSource.findByPk(req.params.id, { attributes: ['fieldMappingConfig'] });
      const incoming = csvDataSourceService.parseMapping(req.body.fieldMappingConfig);
      const changed = JSON.stringify(incoming) !== JSON.stringify(source?.fieldMappingConfig || {});
      const mayUpdate = req.user!.permissions?.data_sources?.includes('update');
      if (changed && !mayUpdate) throw new CsvDataSourceError('修改字段映射需要 data_sources.update 权限', 'FORBIDDEN', 403);
    }
    const result = await csvDataSourceService.reimport(req.params.id, req.file, req.body, req.user!.userId);
    uploadOperations.inc({ outcome: 'success' });
    res.json({ success: true, data: result });
  } catch (error: any) {
    uploadOperations.inc({ outcome: 'failure' });
    await auditCsvFailure(req, OperationType.UPDATE, 'IMPORT_FAILED', error);
    csvError(res, error, 'IMPORT_FAILED');
  }
});

/**
 * POST /api/account/data-sources/preview-fields
 * 预览数据库字段名 - ADMIN only
 */
router.post('/preview-fields', authorize('data_sources', 'create'), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.previewDbFields(req.body);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'PREVIEW_FAILED', message: error.message } });
  }
});

/**
 * PUT /api/account/data-sources/:id
 * 更新 - ADMIN only
 */
router.put('/:id', authorize('data_sources', 'update'), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.updateDataSource(req.params.id, req.body, req.user!.userId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.message === '数据源不存在' ? 404 : 400;
    res.status(status).json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } });
  }
});

/**
 * PATCH /api/account/data-sources/:id/toggle
 * 启用/停用 - ADMIN only
 */
router.patch('/:id/toggle', authorize('data_sources', 'update'), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.toggleDataSource(req.params.id, req.user!.userId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    const status = error.message === '数据源不存在' ? 404 : 400;
    res.status(status).json({ success: false, error: { code: 'TOGGLE_FAILED', message: error.message } });
  }
});

/**
 * DELETE /api/account/data-sources/:id
 * 删除 - ADMIN only
 */
router.delete('/:id', authorize('data_sources', 'delete'), async (req: Request, res: Response) => {
  try {
    await dataSourceService.deleteDataSource(req.params.id, req.user!.userId);
    res.json({ success: true, message: '数据源已删除' });
  } catch (error: any) {
    const status = error.message === '数据源不存在' ? 404 : 400;
    res.status(status).json({ success: false, error: { code: 'DELETE_FAILED', message: error.message } });
  }
});

/**
 * POST /api/account/data-sources/:id/test-connection
 * 测试连接 - ADMIN only
 */
router.post('/:id/test-connection', authorize('data_sources', 'update'), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.testConnection(req.params.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'TEST_FAILED', message: error.message } });
  }
});

/**
 * GET /api/account/data-sources/:id/preview
 * 预览数据 - ADMIN & AUDITOR
 */
router.get('/:id/preview', authorize('data_sources', 'read'), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.previewData(req.params.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'PREVIEW_FAILED', message: error.message } });
  }
});

/**
 * POST /api/account/data-sources/:id/sync
 * 同步数据 - ADMIN only
 */
router.post('/:id/sync', authorize('data_sources', 'sync'), async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true';
    const result = await dataSourceService.syncData(req.params.id, req.user!.userId, force);
    syncOperations.inc({ outcome: 'success' });
    res.json({ success: true, data: result });
  } catch (error: any) {
    syncOperations.inc({ outcome: 'failure' });
    res.status(400).json({ success: false, error: { code: 'SYNC_FAILED', message: error.message } });
  }
});

/**
 * GET /api/account/data-sources/:id/account-changes
 * 账户变更统计 - ADMIN & AUDITOR
 */
router.get('/:id/account-changes', authorize('data_sources', 'read'), async (req: Request, res: Response) => {
  try {
    const result = await dataSourceService.getAccountChangeStats(req.params.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { code: 'STATS_FAILED', message: error.message } });
  }
});

export default router;
