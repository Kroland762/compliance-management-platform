import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'async_hooks';
import sequelize from '../config/database';
import Tenant, { TenantStatus } from '../models/Tenant';
import { AppError } from '../utils/http';

// 请求级租户上下文存储（Node.js 内置 AsyncLocalStorage，替代 cls-hooked）
export interface TenantStore {
  schema: string;
  tenantId: string | null;
}
const tenantAls = new AsyncLocalStorage<TenantStore>();

// Patch Sequelize 连接池 —— 每次取连接时根据当前请求上下文设 search_path + RLS
let poolPatched = false;
export function initializeTenantConnectionIsolation(): void {
  if (poolPatched) return;
  poolPatched = true;

  const connectionManager = (sequelize as any).connectionManager;
  if (!connectionManager) return;

  const origGetConnection = connectionManager.getConnection.bind(connectionManager);
  connectionManager.getConnection = async function (options: any) {
    const conn = await origGetConnection(options);
    const store = tenantAls.getStore();
    const schema = store?.schema;
    const tenantId = store?.tenantId;
    const searchPath = schema && schema !== 'public'
      ? `"${schema.replace(/"/g, '""')}", public`
      : 'public';
    await new Promise<void>((resolve, reject) => {
      conn.query(
        `SELECT set_config('app.current_tenant_id', $1, false),
                set_config('search_path', $2, false)`,
        [tenantId || '', searchPath],
        (error: Error | null) => error ? reject(error) : resolve(),
      );
    });
    return conn;
  };
}

// 扩展 Express Request
declare global {
  namespace Express {
    interface Request {
      tenant?: {
        id: string;
        name: string;
        slug: string;
        schemaName: string;
      };
    }
  }
}

export function getTenantStore(): TenantStore | undefined {
  return tenantAls.getStore();
}

export function runWithTenantContext<T>(
  context: TenantStore,
  callback: () => T,
): T {
  initializeTenantConnectionIsolation();
  return tenantAls.run(context, callback);
}

function requestedTenantId(req: Request): string | null {
  const value = req.header('X-Tenant-ID');
  return value?.trim() || null;
}

export async function resolveTenantForUser(
  req: Request,
  user: NonNullable<Express.Request['user']>,
): Promise<Tenant | null> {
  const headerTenantId = requestedTenantId(req);

  if (user.tenantId) {
    if (headerTenantId && headerTenantId !== user.tenantId) {
      throw new AppError(403, 'FORBIDDEN', '普通租户用户不能切换或伪造租户上下文');
    }
    const tenant = await Tenant.findByPk(user.tenantId);
    if (!tenant) throw new AppError(403, 'TENANT_NOT_FOUND', '所属租户不存在');
    if (tenant.status !== TenantStatus.ACTIVE) {
      throw new AppError(403, 'TENANT_INACTIVE', '所属租户已停用');
    }
    return tenant;
  }

  if (headerTenantId) {
    throw new AppError(403, 'TENANT_CONTEXT_REQUIRED', '请先通过租户上下文接口签发租户令牌');
  }
  return null;
}

export function enterResolvedTenant(
  req: Request,
  tenant: Tenant | null,
  next: NextFunction,
): void {
  if (!tenant) {
    runWithTenantContext({ schema: 'public', tenantId: null }, next);
    return;
  }
  req.tenant = {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    schemaName: tenant.schemaName,
  };
  runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, next);
}

export function requireTenantContext(req: Request, _res: Response, next: NextFunction): void {
  if (!req.tenant) {
    next(new AppError(403, 'TENANT_CONTEXT_REQUIRED', '请先选择租户后再访问业务数据'));
    return;
  }
  next();
}
