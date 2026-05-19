import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { User, UserRole, Role } from '../models/index';
import type { PermissionMatrix } from '../models/Role';
import { config } from '../config';
import settingsService from './settings.service';
import captchaService from './captcha.service';
import { validatePassword } from '../utils/password';
import auditLogService from './audit-log.service';
import { OperationType } from '../models';

interface TokenPayload {
  userId: string;
  username: string;
  role: string;
  roleId: string;
  tenantId?: string;
}

export interface LoginResult {
  token: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    username: string;
    role: string;
    roleId: string;
    tenantId?: string;
    permissions: PermissionMatrix;
    department: string | null;
    email: string | null;
  };
}

class AuthService {
  async login(username: string, password: string, captchaId?: string, captchaInput?: string): Promise<LoginResult> {
    if (!captchaId || !captchaInput) {
      throw new Error('请输入验证码');
    }
    if (!captchaService.verify(captchaId, captchaInput)) {
      throw new Error('验证码错误或已过期，请刷新后重试');
    }

    const user = await User.findOne({
      where: { username },
      attributes: ['id', 'username', 'passwordHash', 'failedLoginAttempts', 'lockedUntil', 'isActive', 'role', 'roleId', 'department', 'email', 'tenantId'],
    });

    const genericError = '用户名或密码错误';
    if (!user || !user.isActive) throw new Error(genericError);

    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const seconds = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 1000);
      throw new Error(`账户已被锁定，请 ${Math.ceil(seconds / 60)} 分钟后再试`);
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      const security = await settingsService.getSecuritySettings();
      const newAttempts = user.failedLoginAttempts + 1;
      const updates: any = { failedLoginAttempts: newAttempts };
      if (newAttempts >= security.maxLoginAttempts) {
        updates.lockedUntil = new Date(Date.now() + security.lockDurationMinutes * 60 * 1000);
      }
      await user.update(updates);
      if (newAttempts >= security.maxLoginAttempts) {
        throw new Error(`登录失败次数过多，账户已被锁定 ${security.lockDurationMinutes} 分钟`);
      }
      throw new Error(`用户名或密码错误，还剩 ${security.maxLoginAttempts - newAttempts} 次尝试机会`);
    }

    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await user.update({ failedLoginAttempts: 0, lockedUntil: null });
    }
    user.lastLogin = new Date();
    await user.save();

    let roleName: string = user.role;
    let permissions: PermissionMatrix = {};
    let roleId = user.roleId;
    if (roleId) {
      const role = await Role.findByPk(roleId);
      if (role) { roleName = role.name; permissions = role.permissions; }
    }

    const tenantId = (user as any).tenantId || undefined;
    const payload: TokenPayload = { userId: user.id, username: user.username, role: roleName, roleId: roleId || '', tenantId };

    return {
      token: jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn }),
      refreshToken: jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.refreshExpiresIn }),
      expiresIn: config.jwt.expiresIn,
      user: { id: user.id, username: user.username, role: roleName, roleId: roleId || '', tenantId, permissions, department: user.department, email: user.email },
    };
  }

  async verifyTokenAndLoadUser(token: string): Promise<Express.Request['user']> {
    const decoded = jwt.verify(token, config.jwt.secret) as TokenPayload;
    let permissions: PermissionMatrix = {};
    let roleName = decoded.role;
    if (decoded.roleId) {
      const role = await Role.findByPk(decoded.roleId);
      if (role) { roleName = role.name; permissions = role.permissions; }
    }
    return { userId: decoded.userId, username: decoded.username, role: roleName, roleId: decoded.roleId, permissions };
  }

  async verifyToken(token: string): Promise<TokenPayload> {
    try { return jwt.verify(token, config.jwt.secret) as TokenPayload; }
    catch { throw new Error('令牌无效或已过期'); }
  }

  async refreshToken(token: string): Promise<LoginResult> {
    const payload = await this.verifyToken(token);
    const user = await User.findByPk(payload.userId);
    if (!user || !user.isActive) throw new Error('用户不存在或已禁用');
    return this.generateTokens(user);
  }

  async hashPassword(password: string): Promise<string> { return bcrypt.hash(password, 10); }

  async createUser(data: { username: string; password: string; roleId: string; department?: string; email?: string; tenantId?: string }, createdBy?: string): Promise<User> {
    const validation = validatePassword(data.password);
    if (!validation.valid) throw new Error(`密码不符合要求: ${validation.errors.join('；')}`);
    const existing = await User.findOne({ where: { username: data.username } });
    if (existing) throw new Error('用户名已被占用');
    const role = await Role.findByPk(data.roleId);
    if (!role) throw new Error('所选角色不存在');
    const passwordHash = await this.hashPassword(data.password);
    const user = await User.create({
      username: data.username, passwordHash, role: 'user' as any, roleId: data.roleId,
      department: data.department || null, email: data.email || null,
      tenantId: data.tenantId || null,
    } as any);
    if (createdBy) {
      await auditLogService.log({ userId: createdBy, operationType: OperationType.CREATE, resourceType: 'user', resourceId: user.id, operationDetails: `创建用户: ${data.username}`, success: true });
    }
    return user;
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const validation = validatePassword(newPassword);
    if (!validation.valid) throw new Error(`新密码不符合要求: ${validation.errors.join('；')}`);
    const user = await User.findByPk(userId);
    if (!user) throw new Error('用户不存在');
    const isValid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isValid) throw new Error('原密码错误');
    await user.update({ passwordHash: await this.hashPassword(newPassword) });
  }

  async resetPassword(userId: string, newPassword: string): Promise<void> {
    const validation = validatePassword(newPassword);
    if (!validation.valid) throw new Error(`密码不符合要求: ${validation.errors.join('；')}`);
    const user = await User.findByPk(userId);
    if (!user) throw new Error('用户不存在');
    await user.update({ passwordHash: await this.hashPassword(newPassword) });
  }

  private async generateTokens(user: User): Promise<LoginResult> {
    let roleName: string = user.role;
    let permissions: PermissionMatrix = {};
    let roleId = user.roleId;
    if (roleId) {
      const role = await Role.findByPk(roleId);
      if (role) { roleName = role.name; permissions = role.permissions; }
    }
    const tenantId = (user as any).tenantId || undefined;
    const payload: TokenPayload = { userId: user.id, username: user.username, role: roleName, roleId: roleId || '', tenantId };
    return {
      token: jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn }),
      refreshToken: jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.refreshExpiresIn }),
      expiresIn: config.jwt.expiresIn,
      user: { id: user.id, username: user.username, role: roleName, roleId: roleId || '', tenantId, permissions, department: user.department, email: user.email },
    };
  }
}

export default new AuthService();
