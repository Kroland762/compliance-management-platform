import { createHash } from 'crypto';
import Papa from 'papaparse';
import sequelize from '../../config/database';
import {
  AccountData,
  DataSource,
  DataSourceStatus,
  DataSourceType,
  DataTier,
  MappingStatus,
} from '../../models/account';
import { OperationType } from '../../models';
import { normalizeOriginalFilename } from '../../utils/upload';
import auditLogService from '../audit-log.service';
import { decodeCsvBuffer } from '../evidence-preview.service';
import objectAccessService from '../object-access.service';

const MAX_CSV_ROWS = 10_000;
const MAX_CSV_BYTES = 50 * 1024 * 1024;
const SAMPLE_ROWS = 10;
const ALLOWED_DELIMITERS = new Set([',', ';', '\t']);

type RequestUser = NonNullable<Express.Request['user']>;

export type FieldMappingConfig = Record<string, string | {
  sourceField?: string;
  convert?: Record<string, unknown>;
}>;

export class CsvDataSourceError extends Error {
  constructor(
    message: string,
    public readonly code = 'CSV_IMPORT_FAILED',
    public readonly status = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CsvDataSourceError';
  }
}

interface ParsedCsv {
  originalName: string;
  size: number;
  sha256: string;
  encoding: 'UTF-8' | 'GB18030';
  delimiter: string;
  headers: string[];
  headerFingerprint: string;
  rows: Record<string, string>[];
}

function sourceField(mapping: FieldMappingConfig[string]): string {
  return typeof mapping === 'string' ? mapping : String(mapping?.sourceField || '');
}

function normalizeMapping(input: unknown): FieldMappingConfig {
  if (!input) return {};
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      throw new CsvDataSourceError('字段映射格式无效', 'INVALID_MAPPING');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CsvDataSourceError('字段映射格式无效', 'INVALID_MAPPING');
  }

  const result: FieldMappingConfig = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) throw new CsvDataSourceError('标准字段名不能为空', 'INVALID_MAPPING');
    if (typeof raw === 'string') {
      if (raw.trim()) result[key] = raw.trim();
      continue;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new CsvDataSourceError(`字段 ${key} 的映射格式无效`, 'INVALID_MAPPING');
    }
    const source = String((raw as any).sourceField || '').trim();
    if (!source) continue;
    const convert = (raw as any).convert;
    if (convert !== undefined && (!convert || typeof convert !== 'object' || Array.isArray(convert))) {
      throw new CsvDataSourceError(`字段 ${key} 的值转换格式无效`, 'INVALID_MAPPING');
    }
    result[key] = convert ? { sourceField: source, convert: { ...convert } } : { sourceField: source };
  }
  return result;
}

function parseCsv(file: Express.Multer.File, delimiterOverride?: unknown): ParsedCsv {
  if (!file?.buffer?.length) throw new CsvDataSourceError('请上传有效的 CSV 文件', 'NO_FILE');
  if (file.buffer.length > MAX_CSV_BYTES) throw new CsvDataSourceError('CSV 文件不能超过 50 MB', 'FILE_TOO_LARGE');
  if (file.buffer.includes(0)) throw new CsvDataSourceError('CSV 文件包含无效二进制内容', 'INVALID_CSV');

  const decoded = decodeCsvBuffer(file.buffer);
  const requestedDelimiter = String(delimiterOverride || '');
  if (requestedDelimiter && !ALLOWED_DELIMITERS.has(requestedDelimiter)) {
    throw new CsvDataSourceError('CSV 分隔符仅支持逗号、分号或制表符', 'INVALID_DELIMITER');
  }

  const parsed = Papa.parse<string[]>(decoded.text, {
    delimiter: requestedDelimiter || '',
    skipEmptyLines: 'greedy',
  });
  const fatalErrors = parsed.errors.filter(error => error.code !== 'UndetectableDelimiter');
  if (fatalErrors.length) {
    const first = fatalErrors[0];
    throw new CsvDataSourceError(
      `CSV 解析失败${first.row != null ? `（第 ${first.row + 1} 行）` : ''}: ${first.message}`,
      'INVALID_CSV',
    );
  }

  const parsedRows = parsed.data
    .map(row => row.map(cell => String(cell ?? '')))
    .filter(row => row.some(cell => cell.trim() !== ''));
  if (parsedRows.length < 2) throw new CsvDataSourceError('CSV 必须包含表头和至少一行数据', 'EMPTY_CSV');

  const headers = parsedRows[0].map(header => header.trim());
  if (headers.some(header => !header)) throw new CsvDataSourceError('CSV 表头不能为空', 'INVALID_HEADERS');
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicateHeaders.length) {
    throw new CsvDataSourceError('CSV 表头不能重复', 'INVALID_HEADERS', 400, {
      duplicateHeaders: [...new Set(duplicateHeaders)],
    });
  }

  const dataRows = parsedRows.slice(1);
  if (dataRows.length > MAX_CSV_ROWS) {
    throw new CsvDataSourceError(`CSV 数据行不能超过 ${MAX_CSV_ROWS} 行`, 'ROW_LIMIT_EXCEEDED');
  }
  const invalidWidth = dataRows.findIndex(row => row.length !== headers.length);
  if (invalidWidth >= 0) {
    throw new CsvDataSourceError(`第 ${invalidWidth + 2} 行字段数与表头不一致`, 'INVALID_CSV');
  }

  const delimiter = requestedDelimiter || parsed.meta.delimiter || ',';
  const rows = dataRows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
  return {
    originalName: normalizeOriginalFilename(file.originalname),
    size: file.size || file.buffer.length,
    sha256: createHash('sha256').update(file.buffer).digest('hex'),
    encoding: decoded.encoding,
    delimiter,
    headers,
    headerFingerprint: createHash('sha256').update(headers.join('\u001f')).digest('hex'),
    rows,
  };
}

function mapRow(row: Record<string, string>, mappingConfig: FieldMappingConfig): Record<string, unknown> {
  const mapped: Record<string, unknown> = { _raw: { ...row } };
  for (const [standardField, mapping] of Object.entries(mappingConfig)) {
    const field = sourceField(mapping);
    if (!field || row[field] === undefined) continue;
    const value = row[field];
    const convert = typeof mapping === 'object' ? mapping.convert : undefined;
    mapped[standardField] = convert && Object.prototype.hasOwnProperty.call(convert, value)
      ? convert[value]
      : value;
  }
  return mapped;
}

function cleanValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || ['NULL', 'null', 'N/A', 'NA'].includes(text)) return null;
  return text;
}

function cleanDate(value: unknown): Date | null {
  const text = cleanValue(value);
  if (!text) return null;
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct;
  const normalized = new Date(text.replace(/\//g, '-'));
  return Number.isNaN(normalized.getTime()) ? null : normalized;
}

function parseBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', '是', '已开启'].includes(normalized)) return true;
  if (['false', '0', 'no', '否', '未开启'].includes(normalized)) return false;
  return null;
}

function compatibility(headers: string[], mappingConfig: FieldMappingConfig) {
  const mappedFields = Object.values(mappingConfig).map(sourceField).filter(Boolean);
  const headerSet = new Set(headers);
  const mappedSet = new Set(mappedFields);
  const missingSourceFields = [...new Set(mappedFields.filter(field => !headerSet.has(field)))];
  const newSourceFields = headers.filter(header => !mappedSet.has(header));
  const status = Object.keys(mappingConfig).length === 0
    ? 'UNMAPPED'
    : (!sourceField(mappingConfig.accountId) || missingSourceFields.length > 0 ? 'MAPPING_REQUIRED' : 'COMPATIBLE');
  return { status, missingSourceFields, newSourceFields } as const;
}

class CsvDataSourceService {
  parseMapping(input: unknown): FieldMappingConfig {
    return normalizeMapping(input);
  }

  async preview(file: Express.Multer.File, mappingInput?: unknown, sourceId?: string, delimiter?: unknown, user?: RequestUser) {
    const source = sourceId
      ? (user
        ? await objectAccessService.accountDataSourceOrNotFound(sourceId, user, 'read')
        : await DataSource.findByPk(sourceId))
      : null;
    if (sourceId && (!source || source.sourceType !== DataSourceType.CSV)) {
      throw new CsvDataSourceError('CSV 数据源不存在', 'NOT_FOUND', 404);
    }
    const mappingConfig = mappingInput !== undefined
      ? normalizeMapping(mappingInput)
      : normalizeMapping(source?.fieldMappingConfig || {});
    const parsed = parseCsv(file, delimiter);
    const mappingCompatibility = compatibility(parsed.headers, mappingConfig);
    const mappedRows = mappingCompatibility.status === 'COMPATIBLE'
      ? parsed.rows.map(row => mapRow(row, mappingConfig))
      : [];

    const blankAccountRows = mappedRows
      .map((row, index) => cleanValue(row.accountId) ? null : index + 2)
      .filter((row): row is number => row !== null);
    const accountIds = mappedRows.map(row => cleanValue(row.accountId)).filter((id): id is string => Boolean(id));
    const seen = new Set<string>();
    const duplicateAccountIds = [...new Set(accountIds.filter(id => seen.has(id) || !seen.add(id)))];

    let changeSummary = { newCount: 0, reducedCount: 0, existingCount: 0 };
    if (source && mappingCompatibility.status === 'COMPATIBLE') {
      const currentRows = await AccountData.findAll({
        where: { sourceId: source.id, dataTier: DataTier.HOT },
        attributes: ['accountId'],
      });
      const previous = new Set(currentRows.map(row => row.accountId));
      const current = new Set(accountIds);
      const existingCount = [...current].filter(id => previous.has(id)).length;
      changeSummary = {
        newCount: current.size - existingCount,
        reducedCount: [...previous].filter(id => !current.has(id)).length,
        existingCount,
      };
    }

    return {
      file: {
        originalName: parsed.originalName,
        size: parsed.size,
        sha256: parsed.sha256,
        encoding: parsed.encoding,
        delimiter: parsed.delimiter,
      },
      headers: parsed.headers,
      headerFingerprint: parsed.headerFingerprint,
      rowCount: parsed.rows.length,
      sampleRows: mappedRows.slice(0, SAMPLE_ROWS),
      rawSampleRows: parsed.rows.slice(0, SAMPLE_ROWS),
      savedMapping: mappingConfig,
      compatibility: mappingCompatibility,
      warnings: {
        blankAccountRows: blankAccountRows.slice(0, 20),
        duplicateAccountIds: duplicateAccountIds.slice(0, 20),
        duplicateAccountCount: duplicateAccountIds.length,
      },
      changeSummary,
    };
  }

  async createAndImport(
    file: Express.Multer.File,
    input: { name?: unknown; fieldMappingConfig?: unknown; expectedSha256?: unknown; delimiter?: unknown },
    userId?: string,
  ) {
    const name = String(input.name || '').trim();
    if (!name) throw new CsvDataSourceError('数据源名称不能为空', 'VALIDATION_ERROR');
    const mappingConfig = normalizeMapping(input.fieldMappingConfig);
    const parsed = parseCsv(file, input.delimiter);
    this.assertReadyToImport(parsed, mappingConfig, input.expectedSha256);
    const result = await sequelize.transaction(async transaction => {
      const source = await DataSource.create({
        name,
        sourceType: DataSourceType.CSV,
        connectionConfig: null,
        csvConfig: null,
        fieldMappingConfig: mappingConfig,
        mappingStatus: MappingStatus.CONFIGURED,
        status: DataSourceStatus.ACTIVE,
        totalAccounts: 0,
        createdBy: userId || null,
      } as any, { transaction });
      return this.persistImport(source, parsed, mappingConfig, transaction);
    });
    await this.logImport(userId, result.sourceId, `创建 CSV 数据源并导入 ${result.imported} 条账户数据`, OperationType.CREATE);
    return result;
  }

  async reimport(
    sourceId: string,
    file: Express.Multer.File,
    input: { fieldMappingConfig?: unknown; expectedSha256?: unknown; delimiter?: unknown },
    actor?: RequestUser | string,
  ) {
    const user = typeof actor === 'object' ? actor : undefined;
    const userId = typeof actor === 'string' ? actor : actor?.userId;
    const parsed = parseCsv(file, input.delimiter);
    const result = await sequelize.transaction(async transaction => {
      if (user) await objectAccessService.accountDataSourceOrNotFound(sourceId, user, 'sync');
      const source = await DataSource.findByPk(sourceId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!source || source.sourceType !== DataSourceType.CSV) {
        throw new CsvDataSourceError('CSV 数据源不存在', 'NOT_FOUND', 404);
      }
      const mappingConfig = input.fieldMappingConfig !== undefined
        ? normalizeMapping(input.fieldMappingConfig)
        : normalizeMapping(source.fieldMappingConfig || {});
      this.assertReadyToImport(parsed, mappingConfig, input.expectedSha256);
      const mappingChanged = JSON.stringify(mappingConfig) !== JSON.stringify(normalizeMapping(source.fieldMappingConfig || {}));
      if ((source.csvConfig as any)?.sha256 === parsed.sha256 && !mappingChanged) {
        return {
          sourceId: source.id,
          skipped: true,
          reason: '文件内容与上次导入一致，已跳过',
          imported: 0,
          totalAccounts: source.totalAccounts,
          lastSyncTime: source.lastSyncTime,
        };
      }
      return this.persistImport(source, parsed, mappingConfig, transaction);
    });
    await this.logImport(userId, sourceId, result.skipped ? '重复 CSV 文件，跳过导入' : `重新上传 CSV 并导入 ${result.imported} 条账户数据`);
    return result;
  }

  private assertReadyToImport(parsed: ParsedCsv, mappingConfig: FieldMappingConfig, expectedSha256: unknown): void {
    if (!expectedSha256) {
      throw new CsvDataSourceError('请先预览 CSV 并提交预览哈希', 'PREVIEW_REQUIRED', 400);
    }
    if (String(expectedSha256) !== parsed.sha256) {
      throw new CsvDataSourceError('文件与预览时不一致，请重新预览', 'FILE_CHANGED', 409);
    }
    const result = compatibility(parsed.headers, mappingConfig);
    if (result.status !== 'COMPATIBLE') {
      throw new CsvDataSourceError('CSV 字段与保存的映射不兼容，请修正映射后重试', 'CSV_SCHEMA_MISMATCH', 409, result);
    }
    const mappedRows = parsed.rows.map(row => mapRow(row, mappingConfig));
    const blankRows = mappedRows
      .map((row, index) => cleanValue(row.accountId) ? null : index + 2)
      .filter((row): row is number => row !== null);
    if (blankRows.length) {
      throw new CsvDataSourceError('账户 ID 不能为空', 'MISSING_ACCOUNT_ID', 400, { rows: blankRows.slice(0, 20) });
    }
  }

  private async persistImport(source: DataSource, parsed: ParsedCsv, mappingConfig: FieldMappingConfig, transaction: any) {
    const now = new Date();
    const importBatchId = `BATCH-${Date.now()}-${parsed.sha256.slice(0, 8)}`;
    const mappedRows = parsed.rows.map(row => mapRow(row, mappingConfig));

    const coldDeleted = await AccountData.destroy({
      where: { sourceId: source.id, dataTier: DataTier.COLD },
      transaction,
    });
    await AccountData.update(
      { dataTier: DataTier.COLD },
      { where: { sourceId: source.id, dataTier: DataTier.WARM }, transaction },
    );
    await AccountData.update(
      { dataTier: DataTier.WARM },
      { where: { sourceId: source.id, dataTier: DataTier.HOT }, transaction },
    );
    await AccountData.bulkCreate(mappedRows.map(row => ({
      sourceId: source.id,
      sourceAccountId: cleanValue(row.accountId) || '',
      accountId: cleanValue(row.accountId) || '',
      accountName: cleanValue(row.accountName),
      accountPermission: cleanValue(row.accountPermission),
      createdTime: cleanDate(row.createdTime),
      lastLoginTime: cleanDate(row.lastLoginTime),
      mfaEnabled: parseBoolean(row.mfaEnabled),
      accountStatus: cleanValue(row.accountStatus),
      customFields: row.customFields && typeof row.customFields === 'object' ? row.customFields : null,
      sourceRawData: row._raw || {},
      importBatchId,
      dataTier: DataTier.HOT,
    } as any)), { transaction });

    const csvConfig = {
      originalName: parsed.originalName,
      size: parsed.size,
      sha256: parsed.sha256,
      encoding: parsed.encoding,
      delimiter: parsed.delimiter,
      hasHeader: true,
      headers: parsed.headers,
      headerFingerprint: parsed.headerFingerprint,
      rowCount: parsed.rows.length,
      importedAt: now.toISOString(),
    };
    await source.update({
      csvConfig,
      fieldMappingConfig: mappingConfig,
      mappingStatus: MappingStatus.CONFIGURED,
      totalAccounts: mappedRows.length,
      lastSyncTime: now,
    }, { transaction });

    return {
      sourceId: source.id,
      skipped: false,
      imported: mappedRows.length,
      totalAccounts: mappedRows.length,
      lastSyncTime: now.toISOString(),
      importBatchId,
      lifecycle: { coldDeleted },
      csvConfig,
    };
  }

  private async logImport(
    userId: string | undefined,
    sourceId: string,
    details: string,
    operationType: OperationType = OperationType.UPDATE,
  ) {
    if (!userId) return;
    await auditLogService.log({
      userId,
      operationType,
      resourceType: 'data_source',
      resourceId: sourceId,
      operationDetails: details,
      success: true,
    });
  }
}

export default new CsvDataSourceService();
