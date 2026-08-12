import bcrypt from 'bcrypt';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { AuthSession, Tenant, User, RoleTemplate } from '../models';
import type { PermissionMatrix, PermissionScopeMatrix } from '../models';
import { TenantStatus } from '../models/Tenant';
import { config } from '../config';
import sequelize from '../config/database';
import settingsService from './settings.service';
import captchaService from './captcha.service';
import { validatePassword } from '../utils/password';
import { runWithTenantContext } from '../middlewares/tenant';
import memberContextService, { type ResolvedMemberContext } from './member-context.service';
import { AppError } from '../utils/http';

type TokenKind = 'identity' | 'control' | 'tenant';
type TokenUse = 'access' | 'refresh';

interface AuthContextClaims {
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

interface TokenPayload extends AuthContextClaims {
  tokenUse: TokenUse;
  sessionId: string;
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
  primaryDepartmentName?: string;
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
  private sign(payload: AuthContextClaims, sessionId: string, tokenUse: TokenUse): string {
    return jwt.sign({ ...payload, sessionId, tokenUse }, config.jwt.secret, {
      expiresIn: tokenUse === 'refresh' ? config.jwt.refreshExpiresIn : config.jwt.expiresIn,
      jwtid: randomUUID(),
    });
  }

  private tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private tokenHashMatches(token: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.tokenHash(token), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
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
      primaryDepartmentName: context?.primaryDepartmentName,
      departmentIds: context?.departmentIds || [],
      mustChangePassword: user.mustChangePassword,
      isGlobalAdmin: Boolean(globalRole),
    };
  }

  private async tokens(
    payload: AuthContextClaims,
    sessionId?: string,
    expectedRefreshToken?: string,
  ): Promise<{ token: string; refreshToken: string }> {
    return sequelize.transaction(async (transaction) => {
      const resolvedSessionId = sessionId || randomUUID();
      let session: AuthSession | null = null;
      if (sessionId) {
        session = await AuthSession.findOne({
          where: { id: sessionId, userId: payload.userId },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
          throw new AppError(401, 'UNAUTHORIZED', '登录会话已失效，请重新登录');
        }
        if (expectedRefreshToken && !this.tokenHashMatches(expectedRefreshToken, session.refreshTokenHash)) {
          throw new AppError(401, 'UNAUTHORIZED', '刷新令牌已失效');
        }
      }

      const token = this.sign(payload, resolvedSessionId, 'access');
      const refreshToken = this.sign(payload, resolvedSessionId, 'refresh');
      const sessionValues = {
        refreshTokenHash: this.tokenHash(refreshToken),
        expiresAt: new Date(Date.now() + config.jwt.refreshExpiresIn * 1000),
        revokedAt: null,
      };
      if (session) {
        await session.update(sessionValues, { transaction });
      } else {
        await AuthSession.create({
          id: resolvedSessionId,
          userId: payload.userId,
          ...sessionValues,
        }, { transaction });
      }
      return { token, refreshToken };
    });
  }

  private async issueIdentity(
    user: User,
    status: LoginResult['status'],
    sessionId?: string,
    expectedRefreshToken?: string,
  ): Promise<LoginResult> {
    const globalRole = await this.loadGlobalRole(user);
    const kind: TokenKind = globalRole ? 'control' : 'identity';
    const payload: AuthContextClaims = {
      kind,
      userId: user.id,
      username: user.username,
      tokenVersion: user.tokenVersion,
      passwordChangeRequired: user.mustChangePassword,
      isGlobalAdmin: Boolean(globalRole),
    };
    const contexts = await this.contextsForUser(user);
    const issuedTokens = await this.tokens(payload, sessionId, expectedRefreshToken);
    return {
      status,
      ...issuedTokens,
      expiresIn: config.jwt.expiresIn,
      user: this.identityDto(user, globalRole),
      contexts,
    };
  }

  private async issueTenant(
    user: User,
    tenant: Tenant,
    sessionId?: string,
    expectedRefreshToken?: string,
  ): Promise<LoginResult> {
    const globalRole = await this.loadGlobalRole(user);
    const context = globalRole
      ? null
      : await runWithTenantContext(
        { schema: tenant.schemaName, tenantId: tenant.id },
        () => memberContextService.resolve(user.id),
      );
    const payload: AuthContextClaims = {
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
    const contexts = await this.contextsForUser(user);
    const issuedTokens = await this.tokens(payload, sessionId, expectedRefreshToken);
    return {
      status: user.mustChangePassword ? 'password_change_required' : 'authenticated',
      ...issuedTokens,
      expiresIn: config.jwt.expiresIn,
      user: this.tenantDto(user, tenant.id, context, globalRole),
      contexts,
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
    const [snapshotPasswordValid, security] = await Promise.all([
      bcrypt.compare(password, user.passwordHash),
      settingsService.getSecuritySettings(),
    ]);
    const loginOutcome = await sequelize.transaction(async (transaction) => {
      const currentUser = await User.findByPk(user.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!currentUser || !currentUser.isActive) return { failed: true } as const;
      if (currentUser.lockedUntil && currentUser.lockedUntil.getTime() > Date.now()) {
        return {
          lockedMinutes: Math.ceil((currentUser.lockedUntil.getTime() - Date.now()) / 60_000),
        } as const;
      }
      const isValid = currentUser.passwordHash === user.passwordHash
        ? snapshotPasswordValid
        : await bcrypt.compare(password, currentUser.passwordHash);
      if (!isValid) {
        const attempts = currentUser.failedLoginAttempts + 1;
        await currentUser.update({
          failedLoginAttempts: attempts,
          ...(attempts >= security.maxLoginAttempts
            ? { lockedUntil: new Date(Date.now() + security.lockDurationMinutes * 60_000) }
            : {}),
        }, { transaction });
        return { failed: true } as const;
      }
      await currentUser.update({
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLogin: new Date(),
      }, { transaction });
      return { user: currentUser } as const;
    });
    if ('lockedMinutes' in loginOutcome) {
      throw new AppError(401, 'ACCOUNT_LOCKED', `账户已被锁定，请 ${loginOutcome.lockedMinutes} 分钟后再试`);
    }
    if ('failed' in loginOutcome) throw new AppError(401, 'AUTH_FAILED', genericError);
    const authenticatedUser = loginOutcome.user;
    if (authenticatedUser.mustChangePassword) return this.issueIdentity(authenticatedUser, 'password_change_required');

    const globalRole = await this.loadGlobalRole(authenticatedUser);
    if (globalRole) return this.issueIdentity(authenticatedUser, 'authenticated');
    const contexts = await this.contextsForUser(authenticatedUser);
    if (contexts.length === 1) {
      const tenant = await Tenant.findByPk(contexts[0].id);
      if (!tenant) throw new AppError(403, 'TENANT_NOT_FOUND', '租户不存在');
      return this.issueTenant(authenticatedUser, tenant);
    }
    return this.issueIdentity(authenticatedUser, 'tenant_selection_required');
  }

  async selectContext(userId: string, tenantId: string, sessionId?: string): Promise<LoginResult> {
    const [user, tenant] = await Promise.all([User.findByPk(userId), Tenant.findByPk(tenantId)]);
    if (!user || !user.isActive) throw new AppError(401, 'UNAUTHORIZED', '用户身份无效');
    if (!tenant) throw new AppError(404, 'NOT_FOUND', '租户不存在');
    if (tenant.status !== TenantStatus.ACTIVE) throw new AppError(403, 'TENANT_INACTIVE', '租户已停用');
    return this.issueTenant(user, tenant, sessionId);
  }

  async clearContext(userId: string, sessionId?: string): Promise<LoginResult> {
    const user = await User.findByPk(userId);
    if (!user || !await this.loadGlobalRole(user)) {
      throw new AppError(403, 'FORBIDDEN', '仅全局管理员可进入平台管理');
    }
    return this.issueIdentity(user, 'authenticated', sessionId);
  }

  async verifyTokenAndLoadUser(token: string): Promise<Express.Request['user']> {
    const decoded = await this.verifyToken(token, 'access');
    const [user, session] = await Promise.all([
      User.findByPk(decoded.userId),
      AuthSession.findOne({ where: { id: decoded.sessionId, userId: decoded.userId } }),
    ]);
    if (!user || !user.isActive || user.tokenVersion !== decoded.tokenVersion) {
      throw new AppError(401, 'UNAUTHORIZED', '令牌已失效，请重新登录');
    }
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new AppError(401, 'UNAUTHORIZED', '登录会话已失效，请重新登录');
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
        sessionId: decoded.sessionId,
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
      sessionId: decoded.sessionId,
    };
  }

  async verifyToken(token: string, expectedUse: TokenUse): Promise<TokenPayload> {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as Partial<TokenPayload>;
      if (decoded.tokenUse !== expectedUse
        || typeof decoded.sessionId !== 'string'
        || typeof decoded.userId !== 'string'
        || !['identity', 'control', 'tenant'].includes(String(decoded.kind))) {
        throw new Error('invalid token claims');
      }
      return decoded as TokenPayload;
    } catch {
      throw new AppError(401, 'UNAUTHORIZED', '令牌无效或已过期');
    }
  }

  async refreshToken(token: string): Promise<LoginResult> {
    const payload = await this.verifyToken(token, 'refresh');
    const user = await User.findByPk(payload.userId);
    if (!user || !user.isActive || user.tokenVersion !== payload.tokenVersion) {
      throw new AppError(401, 'UNAUTHORIZED', '刷新令牌已失效');
    }
    if (payload.kind === 'tenant' && payload.tenantId) {
      const tenant = await Tenant.findByPk(payload.tenantId);
      if (!tenant || tenant.status !== TenantStatus.ACTIVE) {
        throw new AppError(403, 'TENANT_INACTIVE', '租户不存在或已停用');
      }
      return this.issueTenant(user, tenant, payload.sessionId, token);
    }
    return this.issueIdentity(
      user,
      user.mustChangePassword ? 'password_change_required' : 'authenticated',
      payload.sessionId,
      token,
    );
  }

  async revokeSession(
    accessToken?: string,
    refreshToken?: string,
  ): Promise<{ userId?: string; sessionId?: string; tenantId?: string }> {
    let accessPayload: TokenPayload | null = null;
    if (accessToken) {
      accessPayload = await this.verifyToken(accessToken, 'access').catch(() => null);
    }
    if (accessPayload) {
      await AuthSession.update(
        { revokedAt: new Date() },
        { where: { id: accessPayload.sessionId, userId: accessPayload.userId, revokedAt: null } },
      );
      return {
        userId: accessPayload.userId,
        sessionId: accessPayload.sessionId,
        tenantId: accessPayload.tenantId,
      };
    }

    if (!refreshToken) return {};
    const refreshPayload = await this.verifyToken(refreshToken, 'refresh').catch(() => null);
    if (!refreshPayload) return {};
    return sequelize.transaction(async (transaction) => {
      const session = await AuthSession.findOne({
        where: { id: refreshPayload.sessionId, userId: refreshPayload.userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!session || session.revokedAt || !this.tokenHashMatches(refreshToken, session.refreshTokenHash)) return {};
      await session.update({ revokedAt: new Date() }, { transaction });
      return {
        userId: refreshPayload.userId,
        sessionId: refreshPayload.sessionId,
        tenantId: refreshPayload.tenantId,
      };
    });
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
    const passwordHash = await this.hashPassword(newPassword);
    await sequelize.transaction(async (transaction) => {
      const currentUser = await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!currentUser) throw new AppError(404, 'NOT_FOUND', '用户不存在');
      if (currentUser.passwordHash !== user.passwordHash
        && !await bcrypt.compare(oldPassword, currentUser.passwordHash)) {
        throw new AppError(400, 'INVALID_PASSWORD', '原密码错误');
      }
      await currentUser.update({
        passwordHash,
        mustChangePassword: false,
        tokenVersion: currentUser.tokenVersion + 1,
      }, { transaction });
      await AuthSession.update(
        { revokedAt: new Date() },
        { where: { userId, revokedAt: null }, transaction },
      );
    });
  }

  async resetPassword(userId: string, newPassword: string): Promise<void> {
    const validation = validatePassword(newPassword);
    if (!validation.valid) throw new AppError(400, 'WEAK_PASSWORD', validation.errors.join('；'));
    const passwordHash = await this.hashPassword(newPassword);
    await sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user) throw new AppError(404, 'NOT_FOUND', '用户不存在');
      await user.update({
        passwordHash,
        mustChangePassword: true,
        tokenVersion: user.tokenVersion + 1,
      }, { transaction });
      await AuthSession.update(
        { revokedAt: new Date() },
        { where: { userId, revokedAt: null }, transaction },
      );
    });
  }
}

export default new AuthService();
