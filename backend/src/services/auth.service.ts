import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Tenant, TenantMemberStatus, User, RoleTemplate } from '../models';
import type { PermissionMatrix, PermissionScopeMatrix } from '../models';
import { TenantStatus } from '../models/Tenant';
import { config } from '../config';
import settingsService from './settings.service';
import captchaService from './captcha.service';
import { validatePassword } from '../utils/password';
import { runWithTenantContext } from '../middlewares/tenant';
import memberContextService, { type ResolvedMemberContext } from './member-context.service';
import { AppError } from '../utils/http';

type TokenKind = 'identity' | 'control' | 'tenant';

interface TokenPayload {
  kind: TokenKind;
  userId: string;
  username: string;
  tenantId?: string;
  memberId?: string;
  roleIds?: string[];
  tokenVersion: number;
  memberSessionVersion?: number;
  passwordChangeRequired?: boolean;
  isGlobalAdmin?: boolean;
}

export interface TenantContextSummary {
  id: string;
  name: string;
  slug: string;
  memberId?: string;
}

export interface AuthenticatedUserDto {
  id: string;
  username: string;
  email: string | null;
  memberId?: string;
  tenantId?: string;
  role: string;
  roleIds: string[];
  permissions: PermissionMatrix;
  permissionScopes: PermissionScopeMatrix;
  primaryDepartmentId?: string;
  departmentIds: string[];
  mustChangePassword: boolean;
  isGlobalAdmin: boolean;
}

export interface LoginResult {
  status: 'authenticated' | 'tenant_selection_required' | 'password_change_required';
  token: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthenticatedUserDto;
  contexts: TenantContextSummary[];
}

class AuthService {
  private sign(payload: TokenPayload, refresh = false): string {
    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: refresh ? config.jwt.refreshExpiresIn : config.jwt.expiresIn,
    });
  }

  private async loadGlobalRole(user: User): Promise<{
    name: string;
    permissions: PermissionMatrix;
    permissionScopes: PermissionScopeMatrix;
  } | null> {
    if (!user.globalRoleTemplateId) return null;
    const role = await RoleTemplate.findByPk(user.globalRoleTemplateId);
    return role ? {
      name: role.name,
      permissions: role.permissions,
      permissionScopes: role.permissionScopes,
    } : null;
  }

  async contextsForUser(user: User): Promise<TenantContextSummary[]> {
    const globalRole = await this.loadGlobalRole(user);
    const tenants = await Tenant.findAll({
      where: { status: TenantStatus.ACTIVE },
      order: [['name', 'ASC']],
    });
    if (globalRole) {
      return tenants.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      }));
    }
    const contexts: TenantContextSummary[] = [];
    for (const tenant of tenants) {
      const member = await runWithTenantContext(
        { schema: tenant.schemaName, tenantId: tenant.id },
        () => memberContextService.resolve(user.id, false),
      );
      if (member) {
        contexts.push({
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          memberId: member.member.id,
        });
      }
    }
    return contexts;
  }

  private identityDto(
    user: User,
    globalRole?: { name: string; permissions: PermissionMatrix; permissionScopes: PermissionScopeMatrix } | null,
  ): AuthenticatedUserDto {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: globalRole?.name || 'identity',
      roleIds: user.globalRoleTemplateId ? [user.globalRoleTemplateId] : [],
      permissions: globalRole?.permissions || {},
      permissionScopes: globalRole?.permissionScopes || {},
      departmentIds: [],
      mustChangePassword: user.mustChangePassword,
      isGlobalAdmin: Boolean(globalRole),
    };
  }

  private tenantDto(
    user: User,
    tenantId: string,
    context: ResolvedMemberContext | null,
    globalRole: { name: string; permissions: PermissionMatrix; permissionScopes: PermissionScopeMatrix } | null,
  ): AuthenticatedUserDto {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      memberId: context?.member.id,
      tenantId,
      role: context?.roleNames.join('、') || globalRole?.name || '全局管理员',
      roleIds: context?.roleIds || [],
      permissions: context?.permissions || globalRole?.permissions || {},
      permissionScopes: context?.permissionScopes || globalRole?.permissionScopes || {},
      primaryDepartmentId: context?.primaryDepartmentId,
      departmentIds: context?.departmentIds || [],
      mustChangePassword: user.mustChangePassword,
      isGlobalAdmin: Boolean(globalRole),
    };
  }

  private tokens(payload: TokenPayload): { token: string; refreshToken: string } {
    return { token: this.sign(payload), refreshToken: this.sign(payload, true) };
  }

  private async issueIdentity(user: User, status: LoginResult['status']): Promise<LoginResult> {
    const globalRole = await this.loadGlobalRole(user);
    const kind: TokenKind = globalRole ? 'control' : 'identity';
    const payload: TokenPayload = {
      kind,
      userId: user.id,
      username: user.username,
      tokenVersion: user.tokenVersion,
      passwordChangeRequired: user.mustChangePassword,
      isGlobalAdmin: Boolean(globalRole),
    };
    return {
      status,
      ...this.tokens(payload),
      expiresIn: config.jwt.expiresIn,
      user: this.identityDto(user, globalRole),
      contexts: await this.contextsForUser(user),
    };
  }

  private async issueTenant(user: User, tenant: Tenant): Promise<LoginResult> {
    const globalRole = await this.loadGlobalRole(user);
    const context = globalRole
      ? null
      : await runWithTenantContext(
        { schema: tenant.schemaName, tenantId: tenant.id },
        () => memberContextService.resolve(user.id),
      );
    const payload: TokenPayload = {
      kind: 'tenant',
      userId: user.id,
      username: user.username,
      tenantId: tenant.id,
      memberId: context?.member.id,
      roleIds: context?.roleIds || [],
      tokenVersion: user.tokenVersion,
      memberSessionVersion: context?.member.sessionVersion,
      passwordChangeRequired: user.mustChangePassword,
      isGlobalAdmin: Boolean(globalRole),
    };
    return {
      status: user.mustChangePassword ? 'password_change_required' : 'authenticated',
      ...this.tokens(payload),
      expiresIn: config.jwt.expiresIn,
      user: this.tenantDto(user, tenant.id, context, globalRole),
      contexts: await this.contextsForUser(user),
    };
  }

  async login(username: string, password: string, captchaId?: string, captchaInput?: string): Promise<LoginResult> {
    const captchaBypass = ['development', 'test'].includes(config.nodeEnv)
      && ['dev_bypass', '0000'].includes(captchaInput || '');
    if (!captchaBypass) {
      if (!captchaId || !captchaInput) throw new AppError(400, 'CAPTCHA_REQUIRED', '请输入验证码');
      if (!captchaService.verify(captchaId, captchaInput)) {
        throw new AppError(400, 'CAPTCHA_INVALID', '验证码错误或已过期，请刷新后重试');
      }
    }
    const user = await User.findOne({ where: { username } });
    const genericError = '用户名或密码错误';
    if (!user || !user.isActive) throw new AppError(401, 'AUTH_FAILED', genericError);
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new AppError(401, 'ACCOUNT_LOCKED', `账户已被锁定，请 ${minutes} 分钟后再试`);
    }
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      const security = await settingsService.getSecuritySettings();
      const attempts = user.failedLoginAttempts + 1;
      await user.update({
        failedLoginAttempts: attempts,
        ...(attempts >= security.maxLoginAttempts
          ? { lockedUntil: new Date(Date.now() + security.lockDurationMinutes * 60_000) }
          : {}),
      });
      throw new AppError(401, 'AUTH_FAILED', genericError);
    }
    await user.update({ failedLoginAttempts: 0, lockedUntil: null, lastLogin: new Date() });
    if (user.mustChangePassword) return this.issueIdentity(user, 'password_change_required');

    const globalRole = await this.loadGlobalRole(user);
    if (globalRole) return this.issueIdentity(user, 'authenticated');
    const contexts = await this.contextsForUser(user);
    if (contexts.length === 1) {
      const tenant = await Tenant.findByPk(contexts[0].id);
      if (!tenant) throw new AppError(403, 'TENANT_NOT_FOUND', '租户不存在');
      return this.issueTenant(user, tenant);
    }
    return this.issueIdentity(user, 'tenant_selection_required');
  }

  async selectContext(userId: string, tenantId: string): Promise<LoginResult> {
    const [user, tenant] = await Promise.all([User.findByPk(userId), Tenant.findByPk(tenantId)]);
    if (!user || !user.isActive) throw new AppError(401, 'UNAUTHORIZED', '用户身份无效');
    if (!tenant) throw new AppError(404, 'NOT_FOUND', '租户不存在');
    if (tenant.status !== TenantStatus.ACTIVE) throw new AppError(403, 'TENANT_INACTIVE', '租户已停用');
    return this.issueTenant(user, tenant);
  }

  async clearContext(userId: string): Promise<LoginResult> {
    const user = await User.findByPk(userId);
    if (!user || !await this.loadGlobalRole(user)) {
      throw new AppError(403, 'FORBIDDEN', '仅全局管理员可退出到控制面');
    }
    return this.issueIdentity(user, 'authenticated');
  }

  async verifyTokenAndLoadUser(token: string): Promise<Express.Request['user']> {
    const decoded = await this.verifyToken(token);
    const user = await User.findByPk(decoded.userId);
    if (!user || !user.isActive || user.tokenVersion !== decoded.tokenVersion) {
      throw new AppError(401, 'UNAUTHORIZED', '令牌已失效，请重新登录');
    }
    const globalRole = await this.loadGlobalRole(user);
    if (decoded.kind === 'tenant') {
      const tenant = decoded.tenantId ? await Tenant.findByPk(decoded.tenantId) : null;
      if (!tenant || tenant.status !== TenantStatus.ACTIVE) {
        throw new AppError(403, 'TENANT_INACTIVE', '租户不存在或已停用');
      }
      const context = globalRole
        ? null
        : await runWithTenantContext(
          { schema: tenant.schemaName, tenantId: tenant.id },
          () => memberContextService.resolve(user.id),
        );
      if (context && context.member.sessionVersion !== decoded.memberSessionVersion) {
        throw new AppError(401, 'UNAUTHORIZED', '成员权限已变化，请重新登录');
      }
      const dto = this.tenantDto(user, tenant.id, context, globalRole);
      return {
        userId: user.id,
        username: user.username,
        role: dto.role,
        roleIds: dto.roleIds,
        memberId: dto.memberId,
        tenantId: tenant.id,
        permissions: dto.permissions,
        permissionScopes: dto.permissionScopes,
        departmentIds: dto.departmentIds,
        primaryDepartmentId: dto.primaryDepartmentId,
        mustChangePassword: user.mustChangePassword,
        isGlobalAdmin: dto.isGlobalAdmin,
        tokenKind: 'tenant',
      };
    }
    const dto = this.identityDto(user, globalRole);
    return {
      userId: user.id,
      username: user.username,
      role: dto.role,
      roleIds: dto.roleIds,
      permissions: dto.permissions,
      permissionScopes: dto.permissionScopes,
      departmentIds: [],
      mustChangePassword: user.mustChangePassword,
      isGlobalAdmin: dto.isGlobalAdmin,
      tokenKind: decoded.kind,
    };
  }

  async verifyToken(token: string): Promise<TokenPayload> {
    try {
      return jwt.verify(token, config.jwt.secret) as TokenPayload;
    } catch {
      throw new AppError(401, 'UNAUTHORIZED', '令牌无效或已过期');
    }
  }

  async refreshToken(token: string): Promise<LoginResult> {
    const payload = await this.verifyToken(token);
    const user = await User.findByPk(payload.userId);
    if (!user || !user.isActive || user.tokenVersion !== payload.tokenVersion) {
      throw new AppError(401, 'UNAUTHORIZED', '刷新令牌已失效');
    }
    if (payload.kind === 'tenant' && payload.tenantId) return this.selectContext(user.id, payload.tenantId);
    return this.issueIdentity(user, user.mustChangePassword ? 'password_change_required' : 'authenticated');
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const validation = validatePassword(newPassword);
    if (!validation.valid) throw new AppError(400, 'WEAK_PASSWORD', validation.errors.join('；'));
    const user = await User.findByPk(userId);
    if (!user) throw new AppError(404, 'NOT_FOUND', '用户不存在');
    if (!await bcrypt.compare(oldPassword, user.passwordHash)) {
      throw new AppError(400, 'INVALID_PASSWORD', '原密码错误');
    }
    await user.update({
      passwordHash: await this.hashPassword(newPassword),
      mustChangePassword: false,
      tokenVersion: user.tokenVersion + 1,
    });
  }

  async resetPassword(userId: string, newPassword: string): Promise<void> {
    const validation = validatePassword(newPassword);
    if (!validation.valid) throw new AppError(400, 'WEAK_PASSWORD', validation.errors.join('；'));
    const user = await User.findByPk(userId);
    if (!user) throw new AppError(404, 'NOT_FOUND', '用户不存在');
    await user.update({
      passwordHash: await this.hashPassword(newPassword),
      mustChangePassword: true,
      tokenVersion: user.tokenVersion + 1,
    });
  }
}

export default new AuthService();
