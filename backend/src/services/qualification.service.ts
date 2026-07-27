import { Op } from 'sequelize';
import { AuditLog, OperationType, Qualification } from '../models';
import { QualificationStatus } from '../models/Qualification';
import { pagination, parsePagination } from '../utils/pagination';

interface QualificationInput {
  name: string;
  category: string;
  certificateNo?: string | null;
  issuer?: string | null;
  ownerCompany?: string | null;
  ownerDepartment?: string | null;
  responsiblePerson?: string | null;
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

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function localDateText(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getQualificationStatus(expiryDate?: string | null): QualificationStatus {
  if (!expiryDate) return QualificationStatus.MISSING;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayText = localDateText(today);
  const expiryText = String(expiryDate).slice(0, 10);
  if (expiryText < todayText) return QualificationStatus.EXPIRED;
  if (expiryText <= localDateText(addDays(today, EXPIRING_DAYS))) return QualificationStatus.EXPIRING;
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
  async list(query: QualificationQuery) {
    const { page, pageSize } = parsePagination(query);
    const where: any = {};

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

  async create(input: QualificationInput, userId: string) {
    this.validate(input);
    const cleaned = this.clean(input);
    const qualification = await Qualification.create({
      ...cleaned,
      name: cleaned.name!,
      category: cleaned.category!,
      createdBy: userId,
    });

    await this.log(userId, OperationType.CREATE, qualification.id, `创建资质: ${qualification.name}`);
    return toView(qualification);
  }

  async update(id: string, input: Partial<QualificationInput>, userId: string) {
    const qualification = await Qualification.findByPk(id);
    if (!qualification) throw new Error('资质记录不存在');
    this.validate({ ...qualification.toJSON(), ...input } as QualificationInput);

    await qualification.update(this.clean(input));
    await this.log(userId, OperationType.UPDATE, id, `更新资质: ${qualification.name}`);
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayText = localDateText(today);
    const expiringText = localDateText(addDays(today, EXPIRING_DAYS));

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
    await AuditLog.create({
      userId,
      operationType,
      resourceType: 'qualification',
      resourceId,
      operationDetails,
      success: true,
    } as any);
  }
}

export default new QualificationService();
