import { Op } from 'sequelize';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DataSource, DataSourceType, DataSourceStatus, MappingStatus, DataTier, AccountData } from '../../models/account';
import auditLogService from '../audit-log.service';
import { OperationType } from '../../models';
import {
  createSecureDataSourceConnection,
  normalizeConnectionConfig,
  sanitizeConnectionConfig,
  validateDataSourceHost,
} from './dataSource-security.service';

interface ListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  sourceType?: DataSourceType;
  status?: DataSourceStatus;
}

interface CreateDataSourceInput {
  name: string;
  sourceType: DataSourceType;
  connectionConfig?: object;
  csvConfig?: object;
  fieldMappingConfig?: object;
}

interface UpdateDataSourceInput {
  name?: string;
  connectionConfig?: object;
  csvConfig?: object;
  fieldMappingConfig?: object;
  status?: DataSourceStatus;
}

class DataSourceService {
  /**
   * 分页列出数据源，支持搜索和筛选
   */
  async listDataSources(query: ListQuery) {
    const { page = 1, pageSize = 20, search, sourceType, status } = query;
    const where: any = {};

    if (search) {
      where.name = { [Op.iLike]: `%${search}%` };
    }
    if (sourceType) {
      where.sourceType = sourceType;
    }
    if (status) {
      where.status = status;
    }

    const { count, rows } = await DataSource.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return {
      items: rows.map(r => this.sanitizeDataSource(r.toJSON())),
      pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
    };
  }

  /**
   * 获取单个数据源
   */
  async getDataSource(id: string) {
    const ds = await DataSource.findByPk(id);
    if (!ds) throw new Error('数据源不存在');
    return this.sanitizeDataSource(ds.toJSON());
  }

  /**
   * 创建数据源（加密数据库密码）
   */
  async createDataSource(data: CreateDataSourceInput, userId?: string) {
    const { name, sourceType, connectionConfig, csvConfig, fieldMappingConfig } = data;

    if (!Object.values(DataSourceType).includes(sourceType)) {
      throw new Error(`无效的数据源类型: ${sourceType}`);
    }

    let sanitizedConnConfig = connectionConfig || null;
    if (sourceType === DataSourceType.DATABASE && connectionConfig) {
      const cfg = normalizeConnectionConfig(connectionConfig);
      await validateDataSourceHost(cfg.host);
      sanitizedConnConfig = cfg;
    }

    const ds = await DataSource.create({
      name,
      sourceType,
      connectionConfig: sanitizedConnConfig as any,
      csvConfig: csvConfig as any,
      fieldMappingConfig: fieldMappingConfig || {},
      mappingStatus: MappingStatus.UNCONFIGURED,
      status: DataSourceStatus.ACTIVE,
      totalAccounts: 0,
      createdBy: userId || null,
    } as any);

    if (userId) {
      await auditLogService.log({
        userId,
        operationType: OperationType.CREATE,
        resourceType: 'data_source',
        resourceId: ds.id,
        operationDetails: `创建数据源: ${name}`,
        success: true,
      });
    }

    return this.sanitizeDataSource(ds.toJSON());
  }

  /**
   * 预览数据库字段名
   */
  async previewDbFields(config: any) {
    const secureConfig = normalizeConnectionConfig(config);
    const testConn = await createSecureDataSourceConnection(secureConfig);

    try {
      await testConn.authenticate();
      const [results] = await testConn.query(
        `SELECT table_name, column_name
           FROM information_schema.columns
          WHERE table_schema = :schema
            AND (:tableName IS NULL OR table_name = :tableName)
          ORDER BY table_name, ordinal_position
          LIMIT 500`,
        { replacements: { schema: secureConfig.schema, tableName: secureConfig.table || null } },
      );
      const fieldDetails = (results as any[]).map((r: any) => ({ table: r.table_name, name: r.column_name }));
      return { columns: [...new Set(fieldDetails.map(field => field.name))], fieldDetails };
    } catch {
      throw new Error('无法读取字段，请检查网络、只读账号、TLS证书和Schema配置');
    } finally {
      await testConn.close();
    }
  }

  /**
   * 从 CSV 文件上传创建数据源
   */
  async createFromUpload(file: Express.Multer.File, body: any, userId?: string) {
    const { name, delimiter, encoding, hasHeader, fieldMappingConfig } = body;

    if (!name) throw new Error('数据源名称不能为空');
    const originalName = path.basename(file.originalname);
    const extension = path.extname(originalName).toLowerCase();
    if (extension !== '.csv') {
      await fs.promises.unlink(file.path).catch(() => {});
      throw new Error('仅允许上传 CSV 文件');
    }
    const fileHash = await new Promise<string>((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(file.path);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(hash.digest('hex')));
    });

    const csvConfig = {
      filePath: file.path,
      originalName,
      delimiter: delimiter || ',',
      encoding: encoding || 'UTF-8',
      hasHeader: hasHeader === 'true' || hasHeader === true,
      size: file.size,
      sha256: fileHash,
    };

    let fieldMapping = {};
    if (fieldMappingConfig) {
      try {
        fieldMapping = typeof fieldMappingConfig === 'string'
          ? JSON.parse(fieldMappingConfig)
          : fieldMappingConfig;
      } catch { fieldMapping = {}; }
    }

    const ds = await DataSource.create({
      name,
      sourceType: DataSourceType.CSV,
      connectionConfig: null,
      csvConfig: csvConfig as any,
      fieldMappingConfig: fieldMapping,
      mappingStatus: Object.keys(fieldMapping).length > 0 ? MappingStatus.CONFIGURED : MappingStatus.UNCONFIGURED,
      status: DataSourceStatus.ACTIVE,
      totalAccounts: 0,
      createdBy: userId || null,
    } as any);

    if (userId) {
      await auditLogService.log({
        userId,
        operationType: OperationType.CREATE,
        resourceType: 'data_source',
        resourceId: ds.id,
        operationDetails: `上传 CSV 创建数据源: ${name}`,
        success: true,
      });
    }

    return this.sanitizeDataSource(ds.toJSON());
  }

  /**
   * 更新数据源
   */
  async updateDataSource(id: string, data: UpdateDataSourceInput, userId?: string) {
    const ds = await DataSource.findByPk(id);
    if (!ds) throw new Error('数据源不存在');

    const updates: any = {};

    if (data.name !== undefined) updates.name = data.name;
    if (data.csvConfig !== undefined) updates.csvConfig = data.csvConfig;
    if (data.fieldMappingConfig !== undefined) {
      updates.fieldMappingConfig = data.fieldMappingConfig;
      // 如果有字段映射配置，更新映射状态
      if (Object.keys(data.fieldMappingConfig).length > 0) {
        updates.mappingStatus = MappingStatus.CONFIGURED;
      } else {
        updates.mappingStatus = MappingStatus.UNCONFIGURED;
      }
    }
    if (data.status !== undefined) updates.status = data.status;

    if (data.connectionConfig !== undefined) {
      const cfg = normalizeConnectionConfig(data.connectionConfig, ds.connectionConfig as any);
      await validateDataSourceHost(cfg.host);
      updates.connectionConfig = cfg;
    }

    await ds.update(updates);

    if (userId) {
      await auditLogService.log({
        userId,
        operationType: OperationType.UPDATE,
        resourceType: 'data_source',
        resourceId: id,
        operationDetails: `更新数据源: ${ds.name}`,
        success: true,
      });
    }

    return this.sanitizeDataSource(ds.toJSON());
  }

  /**
   * 启用/停用数据源
   */
  async toggleDataSource(id: string, userId?: string) {
    const ds = await DataSource.findByPk(id);
    if (!ds) throw new Error('数据源不存在');

    const newStatus = ds.status === DataSourceStatus.ACTIVE
      ? DataSourceStatus.INACTIVE
      : DataSourceStatus.ACTIVE;

    await ds.update({ status: newStatus });

    if (userId) {
      await auditLogService.log({
        userId,
        operationType: OperationType.UPDATE,
        resourceType: 'data_source',
        resourceId: id,
        operationDetails: newStatus === DataSourceStatus.ACTIVE ? '启用数据源' : '停用数据源',
        success: true,
      });
    }

    return { id, status: newStatus };
  }

  /**
   * 删除数据源（同时清理关联的账户数据）
   */
  async deleteDataSource(id: string, userId?: string) {
    const ds = await DataSource.findByPk(id);
    if (!ds) throw new Error('数据源不存在');

    // 删除关联的账户数据
    await AccountData.destroy({ where: { sourceId: id } });
    await ds.destroy();

    if (userId) {
      await auditLogService.log({
        userId,
        operationType: OperationType.DELETE,
        resourceType: 'data_source',
        resourceId: id,
        operationDetails: `删除数据源: ${ds.name}`,
        success: true,
      });
    }
  }

  /**
   * 测试数据库连接
   */
  async testConnection(id: string) {
    const ds = await DataSource.findByPk(id);
    if (!ds) throw new Error('数据源不存在');

    if (ds.sourceType !== DataSourceType.DATABASE || !ds.connectionConfig) {
      throw new Error('仅支持测试数据库类型的数据源连接');
    }

    const secureConfig = normalizeConnectionConfig(ds.connectionConfig);
    const testConn = await createSecureDataSourceConnection(secureConfig);

    try {
      await testConn.authenticate();
      await testConn.close();
      return { success: true, message: '连接成功' };
    } catch {
      await testConn.close().catch(() => {});
      return { success: false, message: '连接失败，请检查网络、只读账号、TLS证书和数据库配置' };
    }
  }

  /**
   * 预览数据源中的前10条数据
   */
  async previewData(id: string) {
    const ds = await DataSource.findByPk(id);
    if (!ds) throw new Error('数据源不存在');

    const data = await AccountData.findAll({
      where: { sourceId: id, dataTier: DataTier.HOT },
      order: [['createdAt', 'DESC']],
      limit: 10,
    });

    return {
      sourceId: id,
      sourceName: ds.name,
      preview: data.map(d => d.toJSON()),
    };
  }

  /**
   * 同步数据：应用3层数据生命周期
   * COLD → 删除, WARM → COLD, HOT → WARM, 新数据 → HOT
   */
  async syncData(id: string, userId?: string, force = false) {
    const ds = await DataSource.findByPk(id);
    if (!ds) throw new Error('数据源不存在');

    // 检查数据源是否有变化，无变化则跳过同步
    if (!force && ds.lastSyncTime) {
      // 1. 数据源配置本身是否变更（updatedAt > lastSyncTime 则需要同步）
      const configChanged = ds.updatedAt && new Date(ds.updatedAt) > new Date(ds.lastSyncTime);
      
      // 2. CSV 文件是否变更
      let fileChanged = false;
      if (ds.sourceType === DataSourceType.CSV) {
        const csvCfg = ds.csvConfig as any;
        if (csvCfg?.filePath) {
          try {
            const fs = await import('fs');
            const stat = fs.statSync(csvCfg.filePath);
            fileChanged = stat.mtime > new Date(ds.lastSyncTime);
          } catch {
            fileChanged = true; // 文件不存在，视为已变更
          }
        }
      } else {
        // 数据库源无法检测变化，始终视为需要同步
        fileChanged = true;
      }

      if (!configChanged && !fileChanged) {
        const hotCount = await AccountData.count({
          where: { sourceId: id, dataTier: DataTier.HOT },
        });
        return {
          sourceId: id,
          skipped: true,
          reason: '数据源无变化，跳过同步（可通过 force=true 强制同步）',
          totalAccounts: hotCount,
          lastSyncTime: ds.lastSyncTime,
        };
      }
    }

    const now = new Date();
    const importBatchId = `BATCH-${Date.now()}`;
    const mappingConfig = ds.fieldMappingConfig as Record<string, string> || {};

    // 0. 从数据源导入新数据
    let newRows: any[] = [];

    if (ds.sourceType === DataSourceType.CSV) {
      const csvCfg = ds.csvConfig as any;
      if (!csvCfg?.filePath) throw new Error('CSV 文件路径未配置');
      newRows = await this.parseCSV(csvCfg, mappingConfig);
    } else if (ds.sourceType === DataSourceType.DATABASE) {
      const connCfg = ds.connectionConfig as any;
      if (!connCfg) throw new Error('数据库连接配置未完成');
      newRows = await this.queryDatabase(connCfg, mappingConfig);
    }

    if (newRows.length === 0) {
      // 数据源无可用数据，仍执行流转
    }

    // 1. COLD → 删除
    const coldDeleted = await AccountData.destroy({
      where: { sourceId: id, dataTier: DataTier.COLD },
    });

    // 2. WARM → COLD
    await AccountData.update(
      { dataTier: DataTier.COLD },
      { where: { sourceId: id, dataTier: DataTier.WARM } },
    );

    // 3. HOT → WARM
    await AccountData.update(
      { dataTier: DataTier.WARM },
      { where: { sourceId: id, dataTier: DataTier.HOT } },
    );

    // 4. 插入新数据 (HOT)
    if (newRows.length > 0) {
      await AccountData.bulkCreate(newRows.map(r => ({
        id: undefined,
        sourceId: id,
        sourceAccountId: this.cleanValue(r.accountId) || '',
        accountId: this.cleanValue(r.accountId) || '',
        accountName: this.cleanValue(r.accountName) || null,
        accountPermission: this.cleanValue(r.accountPermission) || null,
        createdTime: this.cleanDate(r.createdTime),
        lastLoginTime: this.cleanDate(r.lastLoginTime),
        mfaEnabled: this.parseBool(r.mfaEnabled),
        accountStatus: this.cleanValue(r.accountStatus) || null,
        customFields: r.customFields || null,
        sourceRawData: r._raw || {},
        importBatchId,
        dataTier: DataTier.HOT,
      } as any)));
    }

    // 5. 更新统计
    const totalAccounts = await AccountData.count({
      where: { sourceId: id },
    });

    await ds.update({
      totalAccounts,
      lastSyncTime: now,
    });

    if (userId) {
      await auditLogService.log({
        userId,
        operationType: OperationType.UPDATE,
        resourceType: 'data_source',
        resourceId: id,
        operationDetails: `同步数据，导入 ${newRows.length} 条`,
        success: true,
      });
    }

    return {
      sourceId: id,
      imported: newRows.length,
      totalAccounts,
      lastSyncTime: now.toISOString(),
      importBatchId,
      lifecycle: { coldDeleted },
    };
  }

  /**
   * 解析 CSV 文件（内置解析器，无需外部依赖）
   */
  private async parseCSV(csvCfg: any, mappingConfig: Record<string, string>): Promise<any[]> {
    const fs = await import('fs');

    const filePath = csvCfg.filePath;
    if (!fs.existsSync(filePath)) throw new Error('CSV 数据源文件不存在或已被移除');

    const delimiter = csvCfg.delimiter || ',';
    const encoding = csvCfg.encoding || 'UTF-8';
    const hasHeader = csvCfg.hasHeader !== false;

    const raw = fs.readFileSync(filePath, { encoding: encoding as BufferEncoding });
    const lines = raw.split('\n').filter(l => l.trim());
    if (lines.length === 0) return [];

    const parseLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') { inQuotes = !inQuotes; }
        else if (ch === delimiter && !inQuotes) { result.push(current.trim()); current = ''; }
        else { current += ch; }
      }
      result.push(current.trim());
      return result;
    };

    let headers: string[];
    let dataStart: number;

    if (hasHeader) {
      headers = parseLine(lines[0]);
      dataStart = 1;
    } else {
      const colCount = parseLine(lines[0]).length;
      headers = Array.from({ length: colCount }, (_, i) => `col_${i}`);
      dataStart = 0;
    }

    const rows: any[] = [];
    for (let i = dataStart; i < lines.length; i++) {
      const values = parseLine(lines[i]);
      const row: any = {};
      headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

      const mapped: any = { _raw: { ...row } };
      for (const [stdField, srcField] of Object.entries(mappingConfig)) {
        if (srcField && row[srcField] !== undefined) {
          mapped[stdField] = row[srcField];
        }
      }
      // 无映射配置时自动匹配
      if (Object.keys(mappingConfig).length === 0) {
        mapped.accountId = row.account_id || row.accountId || row['账户ID'] || row[headers[0]] || '';
        mapped.accountName = row.account_name || row.accountName || row.username || row['账户名称'] || '';
        mapped.accountPermission = row.role || row.permission || row.accountPermission || row['账户权限'] || '';
        mapped.createdTime = row.created_time || row.createdTime || row.create_date || row['账户创建时间'] || null;
        mapped.lastLoginTime = row.last_login_time || row.lastLoginTime || row.last_access || row['最后登录时间'] || null;
        mapped.mfaEnabled = row.mfa_enabled || row.mfaEnabled || row.mfa_setup || row['是否开启MFA'] || null;
        mapped.accountStatus = row.status || row.accountStatus || row.state || row['账户状态'] || '';
      }
      rows.push(mapped);
    }
    return rows;
  }

  /**
   * 查询数据库获取账户数据
   */
  private async queryDatabase(connCfg: any, mappingConfig: Record<string, string>): Promise<any[]> {
    const secureConfig = normalizeConnectionConfig(connCfg);
    if (!secureConfig.table) throw new Error('数据库数据源必须配置只读表名');
    const conn = await createSecureDataSourceConnection(secureConfig);

    try {
      await conn.authenticate();
      const quotedSchema = `"${secureConfig.schema.replace(/"/g, '""')}"`;
      const quotedTable = `"${secureConfig.table.replace(/"/g, '""')}"`;
      const sql = `SELECT * FROM ${quotedSchema}.${quotedTable} LIMIT ${secureConfig.maxRows}`;
      const [results] = await conn.query(sql);

      return (results as any[]).map((row: any) => {
        const mapped: any = { _raw: { ...row } };
        for (const [stdField, srcField] of Object.entries(mappingConfig)) {
          if (srcField && row[srcField] !== undefined) {
            mapped[stdField] = row[srcField];
          }
        }
        // 无映射时尝试匹配常见字段名
        if (Object.keys(mappingConfig).length === 0) {
          mapped.accountId = row.account_id || row.id || row.user_id || '';
          mapped.accountName = row.account_name || row.username || row.name || '';
          mapped.accountPermission = row.account_permission || row.role || row.permission || '';
          mapped.createdTime = row.created_time || row.created_at || row.create_time || null;
          mapped.lastLoginTime = row.last_login_time || row.last_login_at || row.last_access || null;
          mapped.mfaEnabled = row.mfa_enabled || row.mfa || null;
          mapped.accountStatus = row.account_status || row.status || row.state || null;
        }
        return mapped;
      });
    } catch {
      throw new Error('数据库同步失败，请检查网络、只读账号、TLS证书、Schema和表配置');
    } finally {
      await conn.close();
    }
  }

  private parseBool(val: any): boolean | null {
    if (val === null || val === undefined || val === '') return null;
    if (typeof val === 'boolean') return val;
    if (val === 'true' || val === '1' || val === 1 || val === 'yes') return true;
    if (val === 'false' || val === '0' || val === 0 || val === 'no') return false;
    return null;
  }

  /** 清洗值：空字符串 / "NULL" / "null" → null，日期字符串尝试解析 */
  private cleanValue(val: any): any {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') {
      const t = val.trim();
      if (t === '' || t === 'NULL' || t === 'null' || t === 'N/A' || t === 'NA') return null;
      return t;
    }
    return val;
  }

  private cleanDate(val: any): Date | null {
    const cleaned = this.cleanValue(val);
    if (!cleaned || typeof cleaned !== 'string') return null;
    // 尝试多种日期格式
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d;
    // 处理 "2021/6/29 14:14" 格式
    const slashDate = new Date(cleaned.replace(/\//g, '-'));
    if (!isNaN(slashDate.getTime())) return slashDate;
    return null;
  }

  /**
   * 获取账户变更统计：对比 HOT 和 WARM 的数据
   * 新增 = HOT 中有但 WARM 中没有
   * 减少 = WARM 中有但 HOT 中没有
   * 存量 = HOT 和 WARM 中都有的
   */
  async getAccountChangeStats(sourceId: string) {
    const ds = await DataSource.findByPk(sourceId);
    if (!ds) throw new Error('数据源不存在');

    const hotAccounts = await AccountData.findAll({
      where: { sourceId, dataTier: DataTier.HOT },
      attributes: ['accountId'],
    });
    const warmAccounts = await AccountData.findAll({
      where: { sourceId, dataTier: DataTier.WARM },
      attributes: ['accountId'],
    });

    const hotSet = new Set(hotAccounts.map(a => a.accountId));
    const warmSet = new Set(warmAccounts.map(a => a.accountId));

    const intersection = [...hotSet].filter(id => warmSet.has(id));

    return {
      sourceId,
      sourceName: ds.name,
      newCount: hotSet.size - intersection.length,
      reducedCount: warmSet.size - intersection.length,
      existingCount: intersection.length,
      hotTotal: hotSet.size,
      warmTotal: warmSet.size,
    };
  }

  /**
   * 清理返回给前端的数据源对象（不暴露加密密码明文）
   */
  private sanitizeDataSource(ds: any) {
    if (ds.connectionConfig) {
      ds.connectionConfig = sanitizeConnectionConfig(ds.connectionConfig);
    }
    return ds;
  }
}

export default new DataSourceService();
