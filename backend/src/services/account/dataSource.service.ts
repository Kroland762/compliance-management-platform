import { Op } from 'sequelize';
import dns from 'dns/promises';
import net from 'net';
import { DataSource, DataSourceType, DataSourceStatus, MappingStatus, DataTier, AccountData, AccountAuditTask } from '../../models/account';
import { encrypt, decrypt } from '../../utils/crypto';
import auditLogService from '../audit-log.service';
import { OperationType } from '../../models';
import { config as appConfig } from '../../config';
import { pagination, parsePagination } from '../../utils/pagination';

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
  fieldMappingConfig?: object;
}

interface UpdateDataSourceInput {
  name?: string;
  connectionConfig?: object;
  fieldMappingConfig?: object;
  status?: DataSourceStatus;
}

class DataSourceService {
  private normalizeIp(ip: string): { address: string; isIpv4Mapped: boolean } {
    const input = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (net.isIPv4(input)) return { address: input, isIpv4Mapped: false };
    if (!net.isIPv6(input)) return { address: input, isIpv4Mapped: false };

    try {
      const canonical = new URL(`http://[${input}]/`).hostname.slice(1, -1);
      const mapped = canonical.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (!mapped) return { address: canonical, isIpv4Mapped: false };

      const high = parseInt(mapped[1], 16);
      const low = parseInt(mapped[2], 16);
      return {
        address: [
          high >> 8,
          high & 0xff,
          low >> 8,
          low & 0xff,
        ].join('.'),
        isIpv4Mapped: true,
      };
    } catch {
      return { address: input, isIpv4Mapped: false };
    }
  }

  private isMetadataIp(ip: string): boolean {
    const normalized = this.normalizeIp(ip).address;
    return normalized === '169.254.169.254'
      || normalized === 'fd00:ec2::254'
      || normalized === 'fe80::a9fe:a9fe';
  }

  private identifier(value: unknown, label: string): string {
    if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(value)) {
      throw new Error(`${label} 只能使用 PostgreSQL 普通标识符`);
    }
    return `"${value.replace(/"/g, '""')}"`;
  }

  private assertPostgresConfig(config: any, requireAllowedColumns = true): void {
    const dialect = String(config?.dbType || config?.dialect || '').toLowerCase();
    if (!config || !['postgres', 'postgresql'].includes(dialect)) {
      throw new Error('仅支持 PostgreSQL 只读数据源');
    }
    if (config.sql) throw new Error('不允许配置任意 SQL，请使用只读表和字段映射');
    this.identifier(config.schema || 'public', 'schema');
    this.identifier(config.table, 'table');
    const columns = Array.isArray(config.allowedColumns) ? config.allowedColumns : Object.values(config.fieldMapping || {});
    if (requireAllowedColumns && !columns.length) throw new Error('必须配置 allowedColumns 只读字段白名单');
    columns.forEach((column: unknown) => this.identifier(column, '字段'));
    if (appConfig.nodeEnv === 'production' && config.ssl !== true) {
      throw new Error('生产环境 PostgreSQL 数据源必须启用 TLS');
    }
  }

  private isBlockedIp(
    ip: string,
    allowPrivateHosts = appConfig.security.allowPrivateDataSourceHosts,
  ): boolean {
    const normalizedIp = this.normalizeIp(ip);

    // IPv4-mapped IPv6 can bypass IPv4-only allow/deny checks. DNS lookup returns
    // ordinary IPv4 addresses, so rejecting this ambiguous direct form preserves
    // legitimate private PostgreSQL hosts without weakening metadata protection.
    if (normalizedIp.isIpv4Mapped || this.isMetadataIp(normalizedIp.address)) return true;
    if (allowPrivateHosts) return false;

    if (net.isIPv4(normalizedIp.address)) {
      const parts = normalizedIp.address.split('.').map(Number);
      const [a, b] = parts;
      return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a === 169 && b === 254 ||
        a === 172 && b >= 16 && b <= 31 ||
        a === 192 && b === 168 ||
        a >= 224
      );
    }

    if (net.isIPv6(normalizedIp.address)) {
      const normalized = normalizedIp.address;
      return (
        normalized === '::1' ||
        normalized === '::' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe80:') ||
        normalized.startsWith('ff')
      );
    }

    return true;
  }

  private async assertAllowedDatabaseHost(host: string): Promise<string> {
    if (!host || typeof host !== 'string') throw new Error('数据库主机不能为空');

    const trimmedHost = host.trim();
    const metadataHosts = new Set(['169.254.169.254', 'metadata.google.internal']);
    if (metadataHosts.has(trimmedHost.toLowerCase())) {
      throw new Error('不允许连接云元数据服务地址');
    }

    const candidates = net.isIP(trimmedHost)
      ? [{ address: trimmedHost }]
      : await dns.lookup(trimmedHost, { all: true });

    if (candidates.some((item) => this.isMetadataIp(item.address))) {
      throw new Error('不允许连接云元数据服务地址');
    }
    const blocked = candidates.find((item) => this.isBlockedIp(item.address));
    if (blocked) {
      throw new Error('生产环境不允许连接本机、内网、链路本地、组播或保留地址；如需启用请显式设置 ALLOW_PRIVATE_DATASOURCE_HOSTS=true');
    }
    return candidates[0].address;
  }

  /**
   * 分页列出数据源，支持搜索和筛选
   */
  async listDataSources(query: ListQuery) {
    const { page, pageSize } = parsePagination(query);
    const { search, sourceType, status } = query;
    const where: any = {};

    if (search) {
      where.name = { [Op.iLike]: `%${search}%` };
    }
    if (sourceType) where.sourceType = sourceType;
    if (status) {
      where.status = status;
    }

    const { count, rows } = await DataSource.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    const taskCounts = await this.taskCounts(rows.map((row) => row.id));
    return {
      items: rows.map((row) => ({ ...this.sanitizeDataSource(row.toJSON()), taskCount: taskCounts.get(row.id) || 0 })),
      pagination: pagination(page, pageSize, count),
    };
  }

  /**
   * 获取单个数据源
   */
  async getDataSource(id: string) {
    const ds = await DataSource.findByPk(id);
    if (!ds) throw new Error('数据源不存在');
    return { ...this.sanitizeDataSource(ds.toJSON()), taskCount: await AccountAuditTask.count({ where: { sourceId: id } }) };
  }

  /**
   * 创建数据源（加密数据库密码）
   */
  async createDataSource(data: CreateDataSourceInput, userId?: string) {
    const { name, sourceType, connectionConfig, fieldMappingConfig } = data;

    if (sourceType !== DataSourceType.DATABASE || !connectionConfig) {
      throw new Error('仅允许创建 PostgreSQL 只读数据源');
    }

    // 对数据库连接配置中的密码字段进行加密
    let sanitizedConnConfig = connectionConfig || null;
    if (sourceType === DataSourceType.DATABASE && connectionConfig) {
      const cfg = { ...(connectionConfig as any) };
      if (!Array.isArray(cfg.allowedColumns)) {
        cfg.allowedColumns = Object.values(fieldMappingConfig || {})
          .map((value: any) => typeof value === 'string' ? value : value?.sourceField)
          .filter(Boolean);
      }
      this.assertPostgresConfig(cfg);
      await this.assertAllowedDatabaseHost(cfg.host);
      if (cfg.password) {
        cfg.password = encrypt(cfg.password);
      }
      sanitizedConnConfig = cfg;
    }

    const ds = await DataSource.create({
      name,
      sourceType,
      connectionConfig: sanitizedConnConfig as any,
      csvConfig: null,
      fieldMappingConfig: fieldMappingConfig || {},
      mappingStatus: Object.keys(fieldMappingConfig || {}).length > 0
        ? MappingStatus.CONFIGURED
        : MappingStatus.UNCONFIGURED,
      status: DataSourceStatus.ACTIVE,
      totalAccounts: 0,
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
    const { host, port, database, username, password } = config;
    if (!host || !port || !database || !username) {
      throw new Error('数据库连接信息不完整');
    }
    this.assertPostgresConfig(config, false);
    const resolvedHost = await this.assertAllowedDatabaseHost(host);

    const { Sequelize } = require('sequelize');
    const testConn = new Sequelize(database, username, password, {
      host: resolvedHost, port: parseInt(port), dialect: 'postgres',
      logging: false,
      pool: { max: 2, min: 0, acquire: 5000, idle: 1000 },
      dialectOptions: {
        statement_timeout: 5000,
        ssl: config.ssl ? { require: true, rejectUnauthorized: true, ca: config.ca || undefined, servername: host } : undefined,
      },
    });

    try {
      await testConn.authenticate();
      await testConn.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
      const [results] = await testConn.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = :schema AND table_name = :table
         ORDER BY ordinal_position LIMIT 100`,
        { replacements: { schema: config.schema || 'public', table: config.table } },
      );
      const columns = (results as any[]).map((r: any) => r.column_name);
      return { columns };
    } finally {
      await testConn.close();
    }
  }

  /**
   * 更新数据源
   */
  async updateDataSource(id: string, data: UpdateDataSourceInput, userId?: string) {
    const ds = await DataSource.findByPk(id);
    if (!ds) throw new Error('数据源不存在');

    const updates: any = {};

    if (data.name !== undefined) updates.name = data.name;
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
      if (ds.sourceType !== DataSourceType.DATABASE) throw new Error('CSV 数据源不支持数据库连接配置');
      const previous = (ds.connectionConfig || {}) as any;
      const incoming = data.connectionConfig as any;
      const cfg = { ...previous, ...incoming };
      if (!incoming.password || incoming.password === '******') cfg.password = previous.password;
      if (!Array.isArray(cfg.allowedColumns)) {
        cfg.allowedColumns = Object.values(data.fieldMappingConfig || ds.fieldMappingConfig || {})
          .map((value: any) => typeof value === 'string' ? value : value?.sourceField)
          .filter(Boolean);
      }
      this.assertPostgresConfig(cfg);
      await this.assertAllowedDatabaseHost(cfg.host);
      // 如果密码字段存在且未加密（不以 iv:tag:cipher 格式出现），则加密
      if (cfg.password && !cfg.password.includes(':')) {
        cfg.password = encrypt(cfg.password);
      }
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
    const ds = await DataSource.findOne({ where: { id, sourceType: DataSourceType.DATABASE } });
    if (!ds) throw new Error('数据源不存在');

    if (ds.sourceType !== DataSourceType.DATABASE || !ds.connectionConfig) {
      throw new Error('仅支持测试数据库类型的数据源连接');
    }

    const config = ds.connectionConfig as any;
    this.assertPostgresConfig(config);
    const resolvedHost = await this.assertAllowedDatabaseHost(config.host);
    let password = config.password || '';
    try {
      password = decrypt(password);
    } catch {
      // 密码可能未加密
    }

    // 使用 Sequelize 测试连接
    const { Sequelize } = require('sequelize');
    const testConn = new Sequelize({
      dialect: 'postgres',
      host: resolvedHost,
      port: config.port || 5432,
      database: config.database,
      username: config.username,
      password: password,
      logging: false,
      pool: { max: 2, min: 0, acquire: 5000, idle: 1000 },
      dialectOptions: config.ssl
        ? { statement_timeout: 5000, ssl: { require: true, rejectUnauthorized: true, ca: config.ca || undefined, servername: config.host } }
        : { statement_timeout: 5000 },
    });

    try {
      await testConn.authenticate();
      await testConn.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
      await testConn.close();
      return { success: true, message: '连接成功' };
    } catch (error: any) {
      await testConn.close().catch(() => {});
      return { success: false, message: `连接失败: ${error.message}` };
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

    const items = data.map(d => d.toJSON());
    return {
      sourceId: id,
      sourceName: ds.name,
      items,
      preview: items,
    };
  }

  /**
   * 同步数据：应用3层数据生命周期
   * COLD → 删除, WARM → COLD, HOT → WARM, 新数据 → HOT
   */
  async syncData(id: string, userId?: string, force = false) {
    const ds = await DataSource.findByPk(id);
    if (!ds) throw new Error('数据源不存在');
    if (ds.sourceType === DataSourceType.CSV) throw new Error('CSV 数据源请使用“重新上传”更新数据');

    // 检查数据源是否有变化，无变化则跳过同步
    if (!force && ds.lastSyncTime) {
      // 1. 数据源配置本身是否变更（updatedAt > lastSyncTime 则需要同步）
      const configChanged = ds.updatedAt && new Date(ds.updatedAt) > new Date(ds.lastSyncTime);
      
      // PostgreSQL 源无法无副作用地检测远端变化，因此默认执行同步。
      const fileChanged = true;

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

    if (ds.sourceType === DataSourceType.DATABASE) {
      const connCfg = ds.connectionConfig as any;
      if (!connCfg) throw new Error('数据库连接配置未完成');
      newRows = await this.queryDatabase(connCfg, mappingConfig);
    } else throw new Error('CSV 数据源已停用，仅支持 PostgreSQL');

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
    const totalAccounts = await AccountData.count({ where: { sourceId: id, dataTier: DataTier.HOT } });

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
   * 查询数据库获取账户数据
   */
  private async queryDatabase(connCfg: any, mappingConfig: Record<string, any>): Promise<any[]> {
    const { Sequelize } = require('sequelize');
    const { decrypt } = require('../../utils/crypto');
    const resolvedHost = await this.assertAllowedDatabaseHost(connCfg.host);

    let password = connCfg.password || '';
    // 尝试解密
    try { password = decrypt(password); } catch {}

    this.assertPostgresConfig(connCfg);

    const conn = new Sequelize(connCfg.database, connCfg.username, password, {
      host: resolvedHost,
      port: parseInt(connCfg.port) || 5432,
      dialect: 'postgres',
      logging: false,
      pool: { max: 2, min: 0, acquire: 5000, idle: 1000 },
      dialectOptions: {
        statement_timeout: 10000,
        ssl: connCfg.ssl ? { require: true, rejectUnauthorized: true, ca: connCfg.ca || undefined, servername: connCfg.host } : undefined,
      },
    });

    try {
      await conn.authenticate();
      await conn.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
      const configuredColumns = connCfg.allowedColumns as string[];
      const [columnRows] = await conn.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = :schemaName AND table_name = :tableName`,
        { replacements: { schemaName: connCfg.schema || 'public', tableName: connCfg.table } },
      );
      const availableColumns = new Set((columnRows as any[]).map(row => String(row.column_name)));
      const mappedColumns = Object.values(mappingConfig)
        .map((mapping: any) => typeof mapping === 'string' ? mapping : mapping?.sourceField)
        .filter(Boolean);
      const missingColumns = [...new Set([...configuredColumns, ...mappedColumns])]
        .filter(column => !availableColumns.has(column));
      if (missingColumns.length) {
        throw new Error(`数据库字段映射已失效，缺少字段: ${missingColumns.join(', ')}`);
      }
      const allowedColumns = configuredColumns.map((column) => this.identifier(column, '字段'));
      const schema = this.identifier(connCfg.schema || 'public', 'schema');
      const table = this.identifier(connCfg.table, 'table');
      const sql = `SELECT ${allowedColumns.join(', ')} FROM ${schema}.${table} LIMIT 10000`;
      const [results] = await conn.query(sql);

      return (results as any[]).map((row: any) => {
        const mapped: any = { _raw: { ...row } };
        for (const [stdField, mapping] of Object.entries(mappingConfig)) {
          const sourceField = typeof mapping === 'string' ? mapping : mapping?.sourceField;
          if (sourceField && row[sourceField] !== undefined) {
            const convert = typeof mapping === 'object' ? mapping.convert : undefined;
            mapped[stdField] = convert && Object.prototype.hasOwnProperty.call(convert, String(row[sourceField]))
              ? convert[String(row[sourceField])]
              : row[sourceField];
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
      const cfg = { ...ds.connectionConfig };
      if (cfg.password) {
        cfg.password = '******';
      }
      ds.connectionConfig = cfg;
    }
    if (ds.csvConfig) {
      const { filePath: _legacyFilePath, ...csvConfig } = ds.csvConfig;
      ds.csvConfig = {
        ...csvConfig,
        needsReupload: !csvConfig.sha256,
      };
    }
    return ds;
  }

  private async taskCounts(sourceIds: string[]): Promise<Map<string, number>> {
    if (!sourceIds.length) return new Map();
    const rows = await AccountAuditTask.findAll({
      where: { sourceId: { [Op.in]: sourceIds } },
      attributes: ['sourceId'],
    });
    const counts = new Map<string, number>();
    rows.forEach((row) => counts.set(row.sourceId, (counts.get(row.sourceId) || 0) + 1));
    return counts;
  }
}

export default new DataSourceService();
