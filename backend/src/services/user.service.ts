import { User, Role } from '../models/index';
import { Op } from 'sequelize';
import bcrypt from 'bcrypt';
import { validatePassword } from '../utils/password';
import { parsePagination, pagination } from '../utils/pagination';

class UserService {
  async createUser(data: { username: string; password: string; department?: string; roleId: string }) {
    const existing = await User.findOne({ where: { username: data.username } });
    if (existing) throw new Error('用户名已存在');

    const validation = validatePassword(data.password);
    if (!validation.valid) {
      throw new Error(`密码不符合要求: ${validation.errors.join('；')}`);
    }

    const role = await Role.findByPk(data.roleId);
    if (!role) throw new Error('所选角色不存在');

    const passwordHash = await bcrypt.hash(data.password, 10);
    return User.create({
      username: data.username,
      passwordHash,
      department: data.department || null,
      // role column kept for backward compat, derived from roleId
      role: 'user' as any,
      roleId: data.roleId,
      isActive: true,
    } as any);
  }

  async getUsers(query: { page?: number; pageSize?: number; roleId?: string; department?: string; isActive?: boolean; keyword?: string; tenantId?: string | null }) {
    const { page, pageSize } = parsePagination(query);
    const { roleId, department, isActive, keyword, tenantId } = query;
    const where: any = {};
    if (roleId) where.roleId = roleId;
    if (department) where.department = department;
    if (isActive !== undefined) where.isActive = isActive;
    if (keyword) where.username = { [Op.iLike]: `%${keyword}%` };
    // 租户过滤：有 tenantId 只查本租户，null（未指定）不过滤
    if (tenantId !== undefined && tenantId !== null) {
      where.tenantId = tenantId;
    }

    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: { exclude: ['passwordHash'] },
      limit: pageSize,
      offset: (page - 1) * pageSize,
      order: [['createdAt', 'ASC']],
    });

    // 加载角色名
    const roleIds = [...new Set(rows.map(u => u.roleId).filter(Boolean))] as string[];
    const roles = await Role.findAll({ where: { id: { [Op.in]: roleIds } } });
    const roleMap = new Map(roles.map(r => [r.id, r.name]));

    const items = rows.map(u => {
      const json = u.toJSON() as any;
      json.roleName = roleMap.get(json.roleId) || json.role;
      return json;
    });

    return {
      items,
      pagination: pagination(page, pageSize, count),
    };
  }

  async getUserById(id: string) {
    const user = await User.findByPk(id, { attributes: { exclude: ['passwordHash'] } });
    if (!user) throw new Error('用户不存在');
    return user;
  }

  async updateUser(id: string, data: { department?: string; email?: string; roleId?: string; isActive?: boolean }) {
    const user = await User.findByPk(id);
    if (!user) throw new Error('用户不存在');

    if (data.department !== undefined) user.department = data.department;
    if (data.email !== undefined) user.email = data.email;
    if (data.roleId !== undefined) {
      const role = await Role.findByPk(data.roleId);
      if (!role) throw new Error('所选角色不存在');
      user.roleId = data.roleId;
    }
    if (data.isActive !== undefined) user.isActive = data.isActive;

    await user.save();
    return this.getUserById(id);
  }

  async disableUser(id: string) {
    return this.updateUser(id, { isActive: false });
  }

  async validateUsername(username: string): Promise<boolean> {
    const user = await User.findOne({ where: { username } });
    return !user;
  }
}

export default new UserService();
