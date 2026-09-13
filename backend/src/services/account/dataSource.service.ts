import { Op } from 'sequelize';
import dns from 'dns/promises';
import net from 'net';
import { DataSource, DataSourceType, DataSourceStatus, MappingStatus, DataTier, AccountData, AccountAuditTask } from '../../models/account';
import { encrypt, decrypt } from '../../utils/crypto';
import auditLogService from '../audit-log.service';
import { OperationType } from '../../models';
import { config as appConfig } from '../../config';
import { pagination, parsePagination } from '../../utils/pagination';
import objectAccessService from '../object-access.service';

type RequestUser = NonNullable<Express.Request['user']>;
type SupportedDbDialect = 'postgres' | 'mysql' | 'mssql' | 'oracle' | 'sqlite';

interface DialectDefinition {
  dialect: SupportedDbDialect;
  label: string;
  defaultPort?: number;
  defaultSchema?: string;
  requiresNetwork: boolean;
  requiresUsername: boolean;
}

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
  private readonly dbDialects: Record<SupportedDbDialect, DialectDefinition> = {
    postgres: { dialect: 'postgres', label: 'PostgreSQL', defaultPort: 5432, defaultSchema: 'public', requiresNetwork: true, requiresUsername: true },
    mysql: { dialect: 'mysql', label: 'MySQL', defaultPort: 3306, requiresNetwork: true, requiresUsername: true },
    mssql: { dialect: 'mssql', label: 'SQL Server', defaultPort: 1433, defaultSchema: 'dbo', requiresNetwork: true, requiresUsername: true },
    oracle: { dialect: 'oracle', label: 'Oracle', defaultPort: 1521, requiresNetwork: true, requiresUsername: true },
    sqlite: { dialect: 'sqlite', label: 'SQLite', requiresNetwork: false, requiresUsername: false },
  };

  private normalizeDialect(value: unknown): SupportedDbDialect {
    const dialect = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (dialect === 'postgres' || dialect === 'postgresql') return 'postgres';
    if (dialect === 'mysql') return 'mysql';
    if (dialect === 'mssql' || dialect === 'sqlserver') return 'mssql';
    if (dialect === 'oracle') return 'oracle';
    if (dialect === 'sqlite' || dialect === 'sqlite3') return 'sqlite';
    throw new Error('仅支持 PostgreSQL、MySQL、SQL Server、Oracle、SQLite 数据源');
  }

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

  private assertIdentifier(value: unknown, label: string): string {
    if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_$]{0,127}$/.test(value)) {
      throw new Error(`${label} 只能使用数据库普通标识符`);
    }
    return value;
  }

  private quoteIdentifier(value: unknown, dialect: SupportedDbDialect, label: string): string {
    const identifier = this.assertIdentifier(value, label);
    if (dialect === 'mysql' || dialect === 'sqlite') return `\`${identifier.replace(/`/g, '``')}\``;
    if (dialect === 'mssql') return `[${identifier.replace(/]/g, ']]')}]`;
    if (dialect === 'oracle') return `"${identifier.toUpperCase().replace(/"/g, '""')}"`;
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private normalizedIdentifier(value: unknown, dialect: SupportedDbDialect, label: string): string {
    const identifier = this.assertIdentifier(value, label);
    return dialect === 'oracle' ? identifier.toUpperCase() : identifier;
  }

  private getSchema(config: any, dialect: SupportedDbDialect): string | undefined {
    if (dialect === 'mysql' || dialect === 'sqlite') return undefined;
    if (typeof config.schema === 'string' && config.schema.trim()) return config.schema.trim();
    if (dialect === 'oracle' && typeof config.username === 'string' && config.username.trim()) return config.username.trim();
    return this.dbDialects[dialect].defaultSchema;
  }

  private tableReference(config: any, dialect: SupportedDbDialect): string {
    const table = this.quoteIdentifier(config.table, dialect, 'table');
    const schema = this.getSchema(config, dialect);
    if (!schema) return table;
    return `${this.quoteIdentifier(schema, dialect, 'schema')}.${table}`;
  }

  private assertDatabaseConfig(config: any, requireAllowedColumns = true): SupportedDbDialect {
    if (!config) throw new Error('数据库连接配置不能为空');
    const dialect = this.normalizeDialect(config.dbType || config.dialect);
    if (config.sql) throw new Error('不允许配置任意 SQL，请使用只读表和字段映射');
    this.assertIdentifier(config.table, 'table');
    const schema = this.getSchema(config, dialect);
    if (schema) this.assertIdentifier(schema, 'schema');
    const columns = Array.isArray(config.allowedColumns) ? config.allowedColumns : Object.values(config.fieldMapping || {});
    if (requireAllowedColumns && !columns.length) throw new Error('必须配置 allowedColumns 只读字段白名单');
    columns.forEach((column: unknown) => this.assertIdentifier(column, '字段'));

    const definition = this.dbDialects[dialect];
    if (definition.requiresNetwork) {
      if (!config.host || typeof config.host !== 'string') throw new Error('数据库主机不能为空');
      if (!config.database || typeof config.database !== 'string') throw new Error('数据库名不能为空');
      if (definition.requiresUsername && !config.username) throw new Error('数据库用户名不能为空');
    } else {
      if (!config.database || typeof config.database !== 'string') throw new Error('SQLite 文件路径不能为空');
      if (config.database === ':memory:') throw new Error('SQLite 数据源必须使用持久化文件路径');
    }
    if (appConfig.nodeEnv === 'production' && definition.requiresNetwork && config.ssl !== true) {
      throw new Error(`生产环境 ${definition.label} 数据源必须启用 TLS`);
    }
    return dialect;
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

  private async resolveDatabaseHostIfNeeded(config: any, dialect: SupportedDbDialect): Promise<string | undefined> {
    return this.dbDialects[dialect].requiresNetwork
      ? await this.assertAllowedDatabaseHost(config.host)
      : undefined;
  }

  private dialectOptions(config: any, dialect: SupportedDbDialect, timeoutMs: number) {
    if (dialect === 'postgres') {
      return config.ssl
        ? { statement_timeout: timeoutMs, ssl: { require: true, rejectUnauthorized: config.rejectUnauthorized !== false, ca: config.ca || undefined, servername: config.host } }
        : { statement_timeout: timeoutMs };
    }
    if (dialect === 'mysql') {
      return config.ssl
        ? { connectTimeout: timeoutMs, ssl: { ca: config.ca || undefined, rejectUnauthorized: config.rejectUnauthorized !== false } }
        : { connectTimeout: timeoutMs };
    }
    if (dialect === 'mssql') {
      return {
        options: {
          requestTimeout: timeoutMs,
          connectTimeout: timeoutMs,
          encrypt: config.ssl === true,
          trustServerCertificate: config.trustServerCertificate === true,
        },
      };
    }
    if (dialect === 'sqlite') {
      const sqlite3 = require('sqlite3');
      return { mode: sqlite3.OPEN_READONLY };
    }
    return {};
  }

  private async createSequelizeConnection(config: any, password: string, requireAllowedColumns: boolean, timeoutMs: number) {
    const dialect = this.assertDatabaseConfig(config, requireAllowedColumns);
    const resolvedHost = await this.resolveDatabaseHostIfNeeded(config, dialect);
    const { Sequelize } = require('sequelize');
    const definition = this.dbDialects[dialect];

    return new Sequelize({
      dialect,
      host: resolvedHost,
      port: config.port ? parseInt(config.port, 10) : definition.defaultPort,
      database: dialect === 'sqlite' ? undefined : config.database,
      username: definition.requiresUsername ? config.username : undefined,
      password: definition.requiresUsername ? password : undefined,
      storage: dialect === 'sqlite' ? config.database : undefined,
      logging: false,
      pool: dialect === 'sqlite'
        ? { max: 1, min: 0, acquire: timeoutMs, idle: 1000 }
        : { max: 2, min: 0, acquire: timeoutMs, idle: 1000 },
      dialectOptions: this.dialectOptions(config, dialect, timeoutMs),
    });
  }

  private async enterReadOnlySession(conn: any, dialect: SupportedDbDialect): Promise<void> {
    try {
      if (dialect === 'postgres') await conn.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
      if (dialect === 'mysql') await conn.query('SET SESSION TRANSACTION READ ONLY');
      if (dialect === 'sqlite') await conn.query('PRAGMA query_only = ON');
    } catch {
      // Some engines only allow read-only mode inside an explicit transaction or
      // expose it through permissions. We still never execute caller-supplied SQL.
    }
  }

  private async getDatabaseColumns(conn: any, config: any, dialect: SupportedDbDialect, limit = 100): Promise<string[]> {
    const table = this.normalizedIdentifier(config.table, dialect, 'table');
    const schema = this.getSchema(config, dialect);
    const normalizedSchema = schema ? this.normalizedIdentifier(schema, dialect, 'schema') : undefined;
    let sql = '';
    let replacements: Record<string, any> = { table, schema: normalizedSchema, database: config.database, limit };

    if (dialect === 'postgres') {
      sql = `SELECT column_name FROM information_schema.columns
             WHERE table_schema = :schema AND table_name = :table
             ORDER BY ordinal_position LIMIT ${Number(limit)}`;
    } else if (dialect === 'mysql') {
      sql = `SELECT COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = :database AND TABLE_NAME = :table
             ORDER BY ORDINAL_POSITION LIMIT ${Number(limit)}`;
    } else if (dialect === 'mssql') {
      sql = `SELECT TOP ${Number(limit)} COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_CATALOG = :database AND TABLE_SCHEMA = :schema AND TABLE_NAME = :table
             ORDER BY ORDINAL_POSITION`;
    } else if (dialect === 'oracle') {
      sql = `SELECT COLUMN_NAME AS column_name FROM ALL_TAB_COLUMNS
             WHERE OWNER = :schema AND TABLE_NAME = :table
             ORDER BY COLUMN_ID FETCH FIRST ${Number(limit)} ROWS ONLY`;
    } else {
      sql = `PRAGMA table_info(${this.quoteIdentifier(table, dialect, 'table')})`;
      replacements = {};
    }

    const [rows] = await conn.query(sql, { replacements });
    return (rows as any[])
      .map((row: any) => row.column_name || row.COLUMN_NAME || row.name || row.NAME)
      .filter(Boolean)
      .map(String);
  }

  private selectRowsSql(config: any, dialect: SupportedDbDialect, columns: string[], limit: number): string {
    const quotedColumns = columns.map((column) => this.quoteIdentifier(column, dialect, '字段')).join(', ');
    const table = this.tableReference(config, dialect);
    if (dialect === 'mssql') return `SELECT TOP ${Number(limit)} ${quotedColumns} FROM ${table}`;
    if (dialect === 'oracle') return `SELECT ${quotedColumns} FROM ${table} FETCH FIRST ${Number(limit)} ROWS ONLY`;
    return `SELECT ${quotedColumns} FROM ${table} LIMIT ${Number(limit)}`;
  }

  private rowValue(row: any, sourceField: string): any {
    if (Object.prototype.hasOwnProperty.call(row, sourceField)) return row[sourceField];
    const upper = sourceField.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(row, upper)) return row[upper];
    const lower = sourceField.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(row, lower)) return row[lower];
    return undefined;
  }

  /**
   * 分页列出数据源，支持搜索和筛选
   */
  async listDataSources(query: ListQuery, user: RequestUser) {
    const { page, pageSize } = parsePagination(query);
    const { search, sourceType, status } = query;
    const where: any = await objectAccessService.accountDataSourceScope(user, 'read');

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
  async getDataSource(id: string, user: RequestUser) {
    const ds = await objectAccessService.accountDataSourceOrNotFound(id, user, 'read');
    return { ...this.sanitizeDataSource(ds.toJSON()), taskCount: await AccountAuditTask.count({ where: { sourceId: id } }) };
  }

  /**
   * 创建数据源（加密数据库密码）
   */
  async createDataSource(data: CreateDataSourceInput, userId?: string) {
    const { name, sourceType, connectionConfig, fieldMappingConfig } = data;

    if (sourceType !== DataSourceType.DATABASE || !connectionConfig) {
      throw new Error('仅允许创建数据库只读数据源；CSV 请使用上传接口');
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
      const dialect = this.assertDatabaseConfig(cfg);
      cfg.dbType = dialect;
      await this.resolveDatabaseHostIfNeeded(cfg, dialect);
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
    const dialect = this.assertDatabaseConfig(config, false);
    const testConn = await this.createSequelizeConnection(config, config.password || '', false, 5000);

    try {
      await testConn.authenticate();
      await this.enterReadOnlySession(testConn, dialect);
      const columns = await this.getDatabaseColumns(testConn, config, dialect);
      return { columns };
    } finally {
      await testConn.close();
    }
  }

  /**
   * 更新数据源
   */
  async updateDataSource(id: string, data: UpdateDataSourceInput, user: RequestUser) {
    const ds = await objectAccessService.accountDataSourceOrNotFound(id, user, 'update');
    const userId = user.userId;

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
      const dialect = this.assertDatabaseConfig(cfg);
      cfg.dbType = dialect;
      await this.resolveDatabaseHostIfNeeded(cfg, dialect);
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
  async toggleDataSource(id: string, user: RequestUser) {
    const ds = await objectAccessService.accountDataSourceOrNotFound(id, user, 'update');
    const userId = user.userId;

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
  async deleteDataSource(id: string, user: RequestUser) {
    const ds = await objectAccessService.accountDataSourceOrNotFound(id, user, 'delete');
    const userId = user.userId;

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
  async testConnection(id: string, user: RequestUser) {
    await objectAccessService.accountDataSourceOrNotFound(id, user, 'update');
    const ds = await DataSource.findOne({ where: { id, sourceType: DataSourceType.DATABASE } });
    if (!ds) throw new Error('数据源不存在');

    if (ds.sourceType !== DataSourceType.DATABASE || !ds.connectionConfig) {
      throw new Error('仅支持测试数据库类型的数据源连接');
    }

    const config = ds.connectionConfig as any;
    const dialect = this.assertDatabaseConfig(config);
    let password = config.password || '';
    try {
      password = decrypt(password);
    } catch {
      // 密码可能未加密
    }

    const testConn = await this.createSequelizeConnection(config, password, true, 5000);

    try {
      await testConn.authenticate();
      await this.enterReadOnlySession(testConn, dialect);
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
  async previewData(id: string, user: RequestUser) {
    const ds = await objectAccessService.accountDataSourceOrNotFound(id, user, 'read');

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
  async syncData(id: string, user: RequestUser, force = false) {
    const ds = await objectAccessService.accountDataSourceOrNotFound(id, user, 'sync');
    const userId = user.userId;
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
    } else throw new Error('CSV 数据源请使用“重新上传”更新数据');

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
    let password = connCfg.password || '';
    // 尝试解密
    try { password = decrypt(password); } catch {}

    const dialect = this.assertDatabaseConfig(connCfg);
    const conn = await this.createSequelizeConnection(connCfg, password, true, 10000);

    try {
      await conn.authenticate();
      await this.enterReadOnlySession(conn, dialect);
      const configuredColumns = connCfg.allowedColumns as string[];
      const columnRows = await this.getDatabaseColumns(conn, connCfg, dialect, 1000);
      const availableColumns = new Set(columnRows.map(column => this.normalizedIdentifier(column, dialect, '字段')));
      const mappedColumns = Object.values(mappingConfig)
        .map((mapping: any) => typeof mapping === 'string' ? mapping : mapping?.sourceField)
        .filter(Boolean);
      const missingColumns = [...new Set([...configuredColumns, ...mappedColumns])]
        .filter(column => !availableColumns.has(this.normalizedIdentifier(column, dialect, '字段')));
      if (missingColumns.length) {
        throw new Error(`数据库字段映射已失效，缺少字段: ${missingColumns.join(', ')}`);
      }
      const sql = this.selectRowsSql(connCfg, dialect, configuredColumns, 10000);
      const [results] = await conn.query(sql);

      return (results as any[]).map((row: any) => {
        const mapped: any = { _raw: { ...row } };
        for (const [stdField, mapping] of Object.entries(mappingConfig)) {
          const sourceField = typeof mapping === 'string' ? mapping : mapping?.sourceField;
          const value = sourceField ? this.rowValue(row, sourceField) : undefined;
          if (sourceField && value !== undefined) {
            const convert = typeof mapping === 'object' ? mapping.convert : undefined;
            mapped[stdField] = convert && Object.prototype.hasOwnProperty.call(convert, String(value))
              ? convert[String(value)]
              : value;
          }
        }
        // 无映射时尝试匹配常见字段名
        if (Object.keys(mappingConfig).length === 0) {
          mapped.accountId = this.rowValue(row, 'account_id') || this.rowValue(row, 'id') || this.rowValue(row, 'user_id') || '';
          mapped.accountName = this.rowValue(row, 'account_name') || this.rowValue(row, 'username') || this.rowValue(row, 'name') || '';
          mapped.accountPermission = this.rowValue(row, 'account_permission') || this.rowValue(row, 'role') || this.rowValue(row, 'permission') || '';
          mapped.createdTime = this.rowValue(row, 'created_time') || this.rowValue(row, 'created_at') || this.rowValue(row, 'create_time') || null;
          mapped.lastLoginTime = this.rowValue(row, 'last_login_time') || this.rowValue(row, 'last_login_at') || this.rowValue(row, 'last_access') || null;
          mapped.mfaEnabled = this.rowValue(row, 'mfa_enabled') || this.rowValue(row, 'mfa') || null;
          mapped.accountStatus = this.rowValue(row, 'account_status') || this.rowValue(row, 'status') || this.rowValue(row, 'state') || null;
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
  async getAccountChangeStats(sourceId: string, user: RequestUser) {
    const ds = await objectAccessService.accountDataSourceOrNotFound(sourceId, user, 'read');

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
