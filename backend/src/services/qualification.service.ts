import { Op, type WhereOptions } from 'sequelize';
import { Department, OperationType, Qualification, TenantMember, TenantMemberStatus } from '../models';
import { QualificationStatus } from '../models/Qualification';
import { config as appConfig } from '../config';
import { pagination, parsePagination } from '../utils/pagination';
import auditLogService from './audit-log.service';
import lookupService from './lookup.service';

type RequestUser = NonNullable<Express.Request['user']>;

interface QualificationInput {
  name: string;
  category: string;
  certificateNo?: string | null;
  issuer?: string | null;
  ownerCompany?: string | null;
  ownerDepartment?: string | null;
  responsiblePerson?: string | null;
  ownerDepartmentId: string;
  responsibleUserId?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  attachmentUrl?: string | null;
  notes?: string | null;
}

interface QualificationQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  category?: string;
  status?: QualificationStatus;
}

const EXPIRING_DAYS = 30;

function normalizeDate(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function businessDateText(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: appConfig.businessTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addCalendarDays(dateText: string, days: number): string {
  const [year, month, day] = dateText.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function getQualificationStatus(expiryDate?: string | null): QualificationStatus {
  if (!expiryDate) return QualificationStatus.MISSING;
  const todayText = businessDateText(new Date());
  const expiryText = String(expiryDate).slice(0, 10);
  if (expiryText < todayText) return QualificationStatus.EXPIRED;
  if (expiryText <= addCalendarDays(todayText, EXPIRING_DAYS)) return QualificationStatus.EXPIRING;
  return QualificationStatus.VALID;
}

function toView(row: Qualification) {
  const data = row.toJSON() as any;
  return {
    ...data,
    status: getQualificationStatus(data.expiryDate),
  };
}

class QualificationService {
  async list(query: QualificationQuery, accessWhere: WhereOptions = {}) {
    const { page, pageSize } = parsePagination(query);
    const where: any = { ...(accessWhere as object) };

    if (query.keyword) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${query.keyword}%` } },
        { certificateNo: { [Op.iLike]: `%${query.keyword}%` } },
        { issuer: { [Op.iLike]: `%${query.keyword}%` } },
        { ownerCompany: { [Op.iLike]: `%${query.keyword}%` } },
        { responsiblePerson: { [Op.iLike]: `%${query.keyword}%` } },
      ];
    }
    if (query.category) where.category = query.category;
    const summaryWhere = { ...where };
    this.applyStatusFilter(where, query.status);

    const [result, total, valid, expiring, expired, missing] = await Promise.all([
      Qualification.findAndCountAll({
      where,
      order: [['expiryDate', 'ASC'], ['createdAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      }),
      Qualification.count({ where: summaryWhere }),
      this.countByStatus(summaryWhere, QualificationStatus.VALID),
      this.countByStatus(summaryWhere, QualificationStatus.EXPIRING),
      this.countByStatus(summaryWhere, QualificationStatus.EXPIRED),
      this.countByStatus(summaryWhere, QualificationStatus.MISSING),
    ]);

    return {
      items: result.rows.map(toView),
      pagination: pagination(page, pageSize, result.count),
      summary: { total, valid, expiring, expired, missing },
    };
  }

  async create(input: QualificationInput, user: RequestUser) {
    this.validate(input);
    await this.validateOwnership(input.ownerDepartmentId, input.responsibleUserId, user);
    const cleaned = this.clean(input);
    const qualification = await Qualification.create({
      ...cleaned,
      name: cleaned.name!,
      category: cleaned.category!,
      ownerDepartmentId: input.ownerDepartmentId,
      responsibleUserId: input.responsibleUserId || null,
      createdBy: user.userId,
    });

    await this.log(user.userId, OperationType.CREATE, qualification.id, `创建资质: ${qualification.name}`);
    return toView(qualification);
  }

  async update(id: string, input: Partial<QualificationInput>, user: RequestUser) {
    const qualification = await Qualification.findByPk(id);
    if (!qualification) throw new Error('资质记录不存在');
    this.validate({ ...qualification.toJSON(), ...input } as QualificationInput);
    await this.validateOwnership(
      input.ownerDepartmentId || qualification.ownerDepartmentId,
      input.responsibleUserId !== undefined ? input.responsibleUserId : qualification.responsibleUserId,
      user,
      id,
    );

    await qualification.update({
      ...this.clean(input),
      ...(input.ownerDepartmentId !== undefined ? { ownerDepartmentId: input.ownerDepartmentId } : {}),
      ...(input.responsibleUserId !== undefined ? { responsibleUserId: input.responsibleUserId || null } : {}),
    });
    await this.log(user.userId, OperationType.UPDATE, id, `更新资质: ${qualification.name}`);
    return toView(qualification);
  }

  async delete(id: string, userId: string) {
    const qualification = await Qualification.findByPk(id);
    if (!qualification) throw new Error('资质记录不存在');
    await qualification.destroy();
    await this.log(userId, OperationType.DELETE, id, `删除资质: ${qualification.name}`);
  }

  private applyStatusFilter(where: any, status?: QualificationStatus) {
    if (!status) return;
    const todayText = businessDateText(new Date());
    const expiringText = addCalendarDays(todayText, EXPIRING_DAYS);

    if (status === QualificationStatus.MISSING) where.expiryDate = { [Op.is]: null };
    if (status === QualificationStatus.EXPIRED) where.expiryDate = { [Op.lt]: todayText };
    if (status === QualificationStatus.EXPIRING) where.expiryDate = { [Op.between]: [todayText, expiringText] };
    if (status === QualificationStatus.VALID) where.expiryDate = { [Op.gt]: expiringText };
  }

  private async countByStatus(baseWhere: any, status: QualificationStatus): Promise<number> {
    const where = { ...baseWhere };
    delete where.expiryDate;
    this.applyStatusFilter(where, status);
    return Qualification.count({ where });
  }

  private validate(input: QualificationInput) {
    if (!input.name?.trim()) throw new Error('资质名称为必填项');
    if (!input.category?.trim()) throw new Error('资质类型为必填项');
    if (!input.ownerDepartmentId) throw new Error('归属部门为必填项');
  }

  private async validateOwnership(departmentId: string, responsibleUserId: string | null | undefined, user: RequestUser, contextId = '') {
    await lookupService.assertOwners('qualification-owner', departmentId, responsibleUserId, user, contextId);
    const department = await Department.findOne({ where: { id: departmentId, status: 'active' } });
    if (!department) throw new Error('归属部门不存在或已归档');
    if (responsibleUserId) {
      const member = await TenantMember.findOne({
        where: { userId: responsibleUserId, status: TenantMemberStatus.ACTIVE },
      });
      if (!member) throw new Error('负责人不存在或不属于当前租户');
    }
  }

  private clean(input: Partial<QualificationInput>) {
    const data: Record<string, string | null> = {};
    const textFields = [
      'name',
      'category',
      'certificateNo',
      'issuer',
      'ownerCompany',
      'ownerDepartment',
      'responsiblePerson',
      'attachmentUrl',
      'notes',
    ] as const;

    textFields.forEach((field) => {
      if (input[field] !== undefined) data[field] = input[field]?.trim() || null;
    });
    if (input.issueDate !== undefined) data.issueDate = normalizeDate(input.issueDate);
    if (input.expiryDate !== undefined) data.expiryDate = normalizeDate(input.expiryDate);
    return data as Partial<QualificationInput>;
  }

  private async log(userId: string, operationType: OperationType, resourceId: string, operationDetails: string) {
    await auditLogService.log({
      userId,
      operationType,
      resourceType: 'qualification',
      resourceId,
      operationDetails,
      success: true,
    });
  }
}

export default new QualificationService();
