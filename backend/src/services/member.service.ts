import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { Op, Transaction } from 'sequelize';
import sequelize from '../config/database';
import {
  Department,
  DepartmentMember,
  MemberInvitation,
  MemberRole,
  Role,
  TenantMember,
  TenantMemberStatus,
  User,
} from '../models';
import { AppError } from '../utils/http';
import { pagination, parsePagination } from '../utils/pagination';
import { validatePassword } from '../utils/password';

export interface DepartmentAssignmentInput {
  departmentId: string;
  isPrimary: boolean;
  positionTitle?: string | null;
}

function generateTemporaryPassword(): string {
  const token = randomBytes(18).toString('base64url');
  return `Aa1!${token}`;
}

class MemberService {
  private async activeAdminCount(transaction: Transaction): Promise<number> {
    return MemberRole.count({
      include: [
        { model: Role, as: 'role', where: { systemKey: 'tenant_admin' }, required: true },
        { model: TenantMember, as: 'member', where: { status: TenantMemberStatus.ACTIVE }, required: true },
      ],
      transaction,
    });
  }

  private async validateRoles(roleIds: string[], transaction?: Transaction): Promise<Role[]> {
    const uniqueIds = Array.from(new Set(roleIds));
    if (uniqueIds.length === 0) throw new AppError(400, 'ROLE_REQUIRED', '至少选择一个角色');
    const roles = await Role.findAll({ where: { id: { [Op.in]: uniqueIds } }, transaction });
    if (roles.length !== uniqueIds.length) throw new AppError(404, 'NOT_FOUND', '角色不存在');
    return roles;
  }

  private async validateDepartments(departments: DepartmentAssignmentInput[], transaction?: Transaction): Promise<Department[]> {
    const uniqueIds = Array.from(new Set(departments.map((item) => item.departmentId)));
    if (departments.filter((item) => item.isPrimary).length !== 1) {
      throw new AppError(400, 'PRIMARY_DEPARTMENT_REQUIRED', '必须且只能选择一个主部门');
    }
    if (uniqueIds.length !== departments.length) throw new AppError(400, 'DUPLICATE_DEPARTMENT', '部门不能重复选择');
    const rows = await Department.findAll({
      where: { id: { [Op.in]: uniqueIds }, status: 'active' },
      transaction,
    });
    if (rows.length !== uniqueIds.length) throw new AppError(404, 'NOT_FOUND', '部门不存在或已归档');
    return rows;
  }

  private async replaceRoles(member: TenantMember, roleIds: string[], transaction: Transaction): Promise<void> {
    await this.validateRoles(roleIds, transaction);
    await MemberRole.destroy({ where: { memberId: member.id }, transaction });
    await MemberRole.bulkCreate(
      Array.from(new Set(roleIds)).map((roleId) => ({ memberId: member.id, roleId })),
      { transaction },
    );
  }

  private async replaceDepartments(
    member: TenantMember,
    departments: DepartmentAssignmentInput[],
    transaction: Transaction,
  ): Promise<void> {
    await this.validateDepartments(departments, transaction);
    await DepartmentMember.destroy({ where: { memberId: member.id }, transaction });
    await DepartmentMember.bulkCreate(
      departments.map((item) => ({
        memberId: member.id,
        departmentId: item.departmentId,
        isPrimary: item.isPrimary,
        positionTitle: item.positionTitle || null,
      })),
      { transaction },
    );
  }

  async list(query: Record<string, unknown>) {
    const { page, pageSize } = parsePagination(query);
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.keyword) where.displayName = { [Op.iLike]: `%${String(query.keyword)}%` };
    const { count, rows } = await TenantMember.findAndCountAll({
      where,
      order: [['createdAt', 'ASC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const items = await Promise.all(rows.map((member) => this.toDto(member)));
    return { items, pagination: pagination(page, pageSize, count) };
  }

  async toDto(member: TenantMember) {
    const [user, roleLinks, departmentLinks] = await Promise.all([
      User.findByPk(member.userId, { attributes: { exclude: ['passwordHash'] } }),
      MemberRole.findAll({ where: { memberId: member.id } }),
      DepartmentMember.findAll({ where: { memberId: member.id } }),
    ]);
    const roleIds = roleLinks.map((link) => link.roleId);
    const departmentIds = departmentLinks.map((link) => link.departmentId);
    const [roles, departments] = await Promise.all([
      roleIds.length ? Role.findAll({ where: { id: { [Op.in]: roleIds } } }) : [],
      departmentIds.length ? Department.findAll({ where: { id: { [Op.in]: departmentIds } } }) : [],
    ]);
    const departmentMap = new Map(departments.map((department) => [department.id, department]));
    return {
      id: member.id,
      userId: member.userId,
      username: user?.username,
      displayName: member.displayName,
      employeeNo: member.employeeNo,
      email: member.email || user?.email || null,
      status: member.status,
      roles: roles.map((role) => ({ id: role.id, name: role.name, isSystem: role.isSystem })),
      departments: departmentLinks.map((link) => ({
        id: link.departmentId,
        name: departmentMap.get(link.departmentId)?.name,
        isPrimary: link.isPrimary,
        positionTitle: link.positionTitle,
      })),
      lastLogin: user?.lastLogin || null,
      joinedAt: member.joinedAt,
      leftAt: member.leftAt,
    };
  }

  async createLocal(input: {
    username: string;
    displayName: string;
    email?: string | null;
    employeeNo?: string | null;
    roleIds: string[];
    departments: DepartmentAssignmentInput[];
    password?: string;
    createdSource?: 'local' | 'provisioning';
  }, outerTransaction?: Transaction): Promise<{ member: TenantMember; temporaryPassword: string }> {
    const existing = await User.findOne({ where: { username: input.username } });
    if (existing) throw new AppError(409, 'CONFLICT', '用户名已存在；请使用邀请已有身份流程');
    const password = input.password || generateTemporaryPassword();
    const validation = validatePassword(password);
    if (!validation.valid) throw new AppError(400, 'WEAK_PASSWORD', validation.errors.join('；'));

    const create = async (transaction: Transaction) => {
      await this.validateRoles(input.roleIds, transaction);
      await this.validateDepartments(input.departments, transaction);
      const user = await User.create({
        username: input.username,
        passwordHash: await bcrypt.hash(password, 12),
        email: input.email || null,
        globalRoleTemplateId: null,
        mustChangePassword: true,
        isActive: true,
      }, { transaction });
      const member = await TenantMember.create({
        userId: user.id,
        displayName: input.displayName,
        email: input.email || null,
        employeeNo: input.employeeNo || null,
        status: TenantMemberStatus.ACTIVE,
        joinedAt: new Date(),
        createdSource: input.createdSource || 'local',
      }, { transaction });
      await this.replaceRoles(member, input.roleIds, transaction);
      await this.replaceDepartments(member, input.departments, transaction);
      return { member, temporaryPassword: password };
    };
    return outerTransaction ? create(outerTransaction) : sequelize.transaction(create);
  }

  async updateMember(
    id: string,
    actorMemberId: string,
    input: { displayName?: string; email?: string | null; employeeNo?: string | null; status?: TenantMemberStatus },
  ): Promise<TenantMember> {
    return sequelize.transaction(async (transaction) => {
      const member = await TenantMember.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!member) throw new AppError(404, 'NOT_FOUND', '成员不存在');
      if (member.id === actorMemberId && input.status && input.status !== TenantMemberStatus.ACTIVE) {
        throw new AppError(409, 'SELF_DISABLE_FORBIDDEN', '不能停用自己的成员身份');
      }
      if (input.status && input.status !== TenantMemberStatus.ACTIVE && member.status === TenantMemberStatus.ACTIVE) {
        const isAdmin = await MemberRole.findOne({
          where: { memberId: member.id },
          include: [{ model: Role, as: 'role', where: { systemKey: 'tenant_admin' }, required: true }],
          transaction,
        });
        if (isAdmin && await this.activeAdminCount(transaction) <= 1) {
          throw new AppError(409, 'LAST_ADMIN_REQUIRED', '不能停用最后一个有效租户管理员');
        }
      }
      await member.update({
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.employeeNo !== undefined ? { employeeNo: input.employeeNo || null } : {}),
        ...(input.status !== undefined ? {
          status: input.status,
          leftAt: input.status === TenantMemberStatus.LEFT ? new Date() : null,
          sessionVersion: member.sessionVersion + 1,
        } : {}),
      }, { transaction });
      return member;
    });
  }

  async setRoles(id: string, actorMemberId: string, roleIds: string[]): Promise<void> {
    await sequelize.transaction(async (transaction) => {
      const member = await TenantMember.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!member) throw new AppError(404, 'NOT_FOUND', '成员不存在');
      const nextRoles = await this.validateRoles(roleIds, transaction);
      if (member.id === actorMemberId && !nextRoles.some((role) => role.systemKey === 'tenant_admin')) {
        throw new AppError(409, 'SELF_DEMOTION_FORBIDDEN', '不能移除自己的租户管理员角色');
      }
      const currentAdmin = await MemberRole.findOne({
        where: { memberId: member.id },
        include: [{ model: Role, as: 'role', where: { systemKey: 'tenant_admin' } }],
        transaction,
      });
      if (currentAdmin && !nextRoles.some((role) => role.systemKey === 'tenant_admin')) {
        if (await this.activeAdminCount(transaction) <= 1) {
          throw new AppError(409, 'LAST_ADMIN_REQUIRED', '不能移除最后一个有效租户管理员');
        }
      }
      await this.replaceRoles(member, roleIds, transaction);
      await member.increment('sessionVersion', { by: 1, transaction });
    });
  }

  async setDepartments(id: string, departments: DepartmentAssignmentInput[]): Promise<void> {
    await sequelize.transaction(async (transaction) => {
      const member = await TenantMember.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!member) throw new AppError(404, 'NOT_FOUND', '成员不存在');
      await this.replaceDepartments(member, departments, transaction);
    });
  }

  async createInvitation(input: {
    targetUserId?: string;
    targetUsername?: string;
    roleIds: string[];
    departments: DepartmentAssignmentInput[];
    createdBy: string;
  }): Promise<{ invitation: MemberInvitation; token: string }> {
    const user = input.targetUserId
      ? await User.findByPk(input.targetUserId)
      : await User.findOne({ where: { username: String(input.targetUsername || '').trim() } });
    if (!user || !user.isActive) throw new AppError(404, 'NOT_FOUND', '用户身份不存在');
    if (await TenantMember.findOne({ where: { userId: user.id } })) {
      throw new AppError(409, 'CONFLICT', '该用户已属于当前租户');
    }
    await this.validateRoles(input.roleIds);
    await this.validateDepartments(input.departments);
    const token = randomBytes(32).toString('base64url');
    const invitation = await MemberInvitation.create({
      targetUserId: user.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      roleIds: input.roleIds,
      departments: input.departments,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      createdBy: input.createdBy,
    });
    return { invitation, token };
  }

  async listInvitations() {
    const invitations = await MemberInvitation.findAll({
      where: { acceptedAt: null, expiresAt: { [Op.gt]: new Date() } },
      order: [['createdAt', 'DESC']],
    });
    const userIds = invitations.map((invitation) => invitation.targetUserId);
    const users = userIds.length
      ? await User.findAll({
        where: { id: { [Op.in]: userIds } },
        attributes: ['id', 'username', 'email'],
      })
      : [];
    const userMap = new Map(users.map((user) => [user.id, user]));
    return invitations.map((invitation) => ({
      id: invitation.id,
      targetUserId: invitation.targetUserId,
      targetUsername: userMap.get(invitation.targetUserId)?.username || null,
      targetEmail: userMap.get(invitation.targetUserId)?.email || null,
      roleIds: invitation.roleIds,
      departments: invitation.departments,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    }));
  }

  async acceptInvitation(token: string, userId: string): Promise<TenantMember> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return sequelize.transaction(async (transaction) => {
      const invitation = await MemberInvitation.findOne({
        where: { tokenHash },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!invitation || invitation.targetUserId !== userId) throw new AppError(404, 'NOT_FOUND', '邀请不存在');
      if (invitation.acceptedAt) throw new AppError(409, 'INVITATION_USED', '邀请已使用');
      if (invitation.expiresAt.getTime() <= Date.now()) throw new AppError(410, 'INVITATION_EXPIRED', '邀请已过期');
      const user = await User.findByPk(userId, { transaction });
      if (!user) throw new AppError(404, 'NOT_FOUND', '用户身份不存在');
      const member = await TenantMember.create({
        userId,
        displayName: user.username,
        email: user.email,
        status: TenantMemberStatus.ACTIVE,
        joinedAt: new Date(),
        createdSource: 'invitation',
      }, { transaction });
      await this.replaceRoles(member, invitation.roleIds, transaction);
      await this.replaceDepartments(member, invitation.departments, transaction);
      await invitation.update({ acceptedAt: new Date() }, { transaction });
      return member;
    });
  }
}

export default new MemberService();
