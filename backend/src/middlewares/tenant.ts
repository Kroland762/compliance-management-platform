import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AsyncLocalStorage } from 'async_hooks';
import sequelize from '../config/database';
import { config } from '../config';
import Tenant, { TenantStatus } from '../models/Tenant';

// 请求级租户上下文存储（Node.js 内置 AsyncLocalStorage，替代 cls-hooked）
interface TenantStore {
  schema: string;
  tenantId: string | null;
}
const tenantAls = new AsyncLocalStorage<TenantStore>();

// Patch Sequelize 连接池 —— 每次取连接时根据当前请求上下文设 search_path + RLS
let poolPatched = false;
function patchConnectionPool() {
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
    if (schema && schema !== 'public') {
      await conn.query('RESET app.current_tenant_id');
      await conn.query(`SET app.current_tenant_id = '${tenantId || ''}'`);
      await conn.query(`SET search_path TO "${schema}", public`);
    } else {
      await conn.query('RESET app.current_tenant_id');
      await conn.query('SET search_path TO public');
    }
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

function getTenantIdFromHeader(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwt.secret) as any;
    return decoded.tenantId || null;
  } catch {
    return null;
  }
}

export function tenantContext(req: Request, res: Response, next: NextFunction): void {
  patchConnectionPool();

  const tenantId = (req.user as any)?.tenantId || getTenantIdFromHeader(req);

  if (!tenantId) {
    tenantAls.run({ schema: 'public', tenantId: null }, () => next());
    return;
  }

  Tenant.findByPk(tenantId)
    .then((tenant) => {
      if (!tenant) {
        res.status(403).json({ success: false, error: { code: 'TENANT_NOT_FOUND', message: '租户不存在' } });
        return;
      }
      if (tenant.status === TenantStatus.SUSPENDED) {
        res.status(403).json({ success: false, error: { code: 'TENANT_SUSPENDED', message: '租户已停用' } });
        return;
      }

      req.tenant = {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        schemaName: tenant.schemaName,
      };

      tenantAls.run(
        { schema: tenant.schemaName, tenantId: tenant.id },
        () => next()
      );
    })
    .catch((err) => {
      res.status(500).json({ success: false, error: { code: 'TENANT_ERROR', message: err.message } });
    });
}
