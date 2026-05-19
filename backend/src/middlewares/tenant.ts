import { Request, Response, NextFunction } from 'express';
import Tenant, { TenantStatus } from '../models/Tenant';
import User from '../models/User';
import Role from '../models/Role';
import SystemSetting from '../models/SystemSetting';

// 所有需要租户隔离的模型（import懒加载避免循环依赖）
const tenantModels: Array<{ schema: (name: string) => void }> = [];

/**
 * 注册需要租户隔离的模型
 */
export function registerTenantModel(model: { schema: (name: string) => void }) {
  tenantModels.push(model);
}

/**
 * 设置当前请求的租户 schema
 */
function setTenantSchema(schemaName: string) {
  for (const model of tenantModels) {
    try { model.schema(schemaName); } catch {}
  }
}

/**
 * 重置所有模型到 public schema（超管请求用）
 */
function resetToPublicSchema() {
  for (const model of tenantModels) {
    try { model.schema('public'); } catch {}
  }
}

/**
 * 根据域名解析租户（可选：用于 SaaS 多域名场景）
 */
async function resolveTenantByDomain(hostname: string): Promise<string | null> {
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
    return null; // 本地开发不启用域名解析
  }
  const tenant = await Tenant.findOne({
    where: { domain: hostname, status: TenantStatus.ACTIVE },
  });
  return tenant?.schemaName || null;
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

/**
 * 租户中间件
 * 1. 从 JWT 中提取 tenantId（需认证后执行）
 * 2. 查找租户并验证状态
 * 3. 设置 Sequelize schema 为租户独立 schema
 */
export function tenantContext(req: Request, res: Response, next: NextFunction): void {
  // 如果没有认证用户信息，跳过（登录等公开路由）
  if (!req.user) {
    next();
    return;
  }

  const tenantId = (req.user as any).tenantId;

  if (!tenantId) {
    // 没有租户ID → 使用默认 schema（向后兼容单租户）
    setTenantSchema('public');
    next();
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

      setTenantSchema(tenant.schemaName);
      next();
    })
    .catch((err) => {
      res.status(500).json({ success: false, error: { code: 'TENANT_ERROR', message: err.message } });
    });
}

export { setTenantSchema, resetToPublicSchema };
