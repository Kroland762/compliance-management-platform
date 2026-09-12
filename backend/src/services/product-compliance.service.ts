import ExcelJS from 'exceljs';
import { Op, type Transaction } from 'sequelize';
import sequelize from '../config/database';
import { THIRD_PARTY_ASSESSMENT_ITEMS } from '../config/product-compliance-template-seed';
import {
  OperationType,
  Product,
  ProductComplianceDossier,
  ProductDataCatalogItem,
  ProductDataItem,
  ProductDossierAnswer,
  ProductDossierQuestionnaire,
  ProductPermissionDataItem,
  ProductPlatformPermission,
  ProductProcessingActivity,
  ProductProcessingDataItem,
  ProductQuestion,
  ProductQuestionnaireTemplate,
  ProductThirdPartyAssessment,
  ProductThirdPartyAssessmentAnswer,
  ProductThirdPartyService,
  ProductType,
  ProductTypeQuestionnaireRule,
  ProductVersion,
  type DossierComplianceConclusion,
  type ProductQuestionType,
} from '../models';
import { AppError } from '../utils/http';
import { assertLockVersion } from '../utils/optimistic-lock';
import { pagination, parsePagination } from '../utils/pagination';
import auditLogService from './audit-log.service';
import objectAccessService from './object-access.service';
import lookupService from './lookup.service';

type RequestUser = NonNullable<Express.Request['user']>;
const QUESTION_TYPES: ProductQuestionType[] = ['boolean', 'single_select', 'multi_select', 'short_text', 'long_text', 'number', 'date'];
const CONCLUSIONS: DossierComplianceConclusion[] = ['not_assessed', 'compliant', 'conditionally_compliant', 'non_compliant'];

interface ProductInput {
  code: string;
  name: string;
  defaultProductTypeId: string;
  ownerUserId: string;
  ownerDepartmentId: string;
  description?: string | null;
}

interface VersionInput {
  version: string;
  productTypeId?: string;
  platforms: string[];
  usageScope: string;
  plannedReleaseDate?: Date | null;
  actualReleaseDate?: Date | null;
  changeDeclaration: Record<string, unknown>;
}

function requiredText(value: unknown, label: string, max = 500): string {
  const result = String(value || '').trim();
  if (!result) throw new AppError(400, 'VALIDATION_ERROR', `${label}不能为空`);
  if (result.length > max) throw new AppError(400, 'VALIDATION_ERROR', `${label}不能超过${max}个字符`);
  return result;
}

function cleanStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function optionalText(value: unknown, max = 4000): string | null {
  const result = String(value || '').trim();
  if (!result) return null;
  return result.length > max ? result.slice(0, max) : result;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function answerPresent(response: unknown): boolean {
  if (response === null || response === undefined || response === '') return false;
  return !Array.isArray(response) || response.length > 0;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join('；');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function styleExportSheet(sheet: ExcelJS.Worksheet): void {
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (sheet.columnCount) sheet.autoFilter = { from: 'A1', to: sheet.getRow(1).getCell(sheet.columnCount).address };
}

class ProductComplianceService {
  private async log(user: RequestUser, resourceType: string, resourceId: string, details: string, operationType = OperationType.UPDATE) {
    await auditLogService.log({
      userId: user.userId,
      operationType,
      resourceType,
      resourceId,
      operationDetails: details,
      success: true,
      departmentId: user.primaryDepartmentId,
    });
  }

  private async validateOwners(ownerDepartmentId: string, ownerUserId: string, user: RequestUser, contextId = '') {
    await lookupService.assertOwners('product-owner', ownerDepartmentId, ownerUserId, user, contextId);
  }

  private async activeType(id: string, transaction?: Transaction) {
    const type = await ProductType.findOne({ where: { id, status: 'active' }, transaction });
    if (!type) throw new AppError(404, 'NOT_FOUND', '产品类型不存在或已停用');
    return type;
  }

  async listProducts(query: Record<string, unknown>, user: RequestUser) {
    const { page, pageSize } = parsePagination(query as any);
    const where: any = await objectAccessService.productScope(user);
    if (query.status) where.status = query.status;
    if (query.productTypeId) where.defaultProductTypeId = query.productTypeId;
    if (query.ownerUserId) where.ownerUserId = query.ownerUserId;
    if (query.keyword) where[Op.or] = [
      { code: { [Op.iLike]: `%${query.keyword}%` } },
      { name: { [Op.iLike]: `%${query.keyword}%` } },
    ];
    const include: any[] = [
      { model: ProductType, as: 'defaultProductType', attributes: ['id', 'name', 'code'] },
      {
        model: ProductVersion,
        as: 'versions',
        separate: true,
        limit: 1,
        order: [['createdAt', 'DESC']],
        include: [{ model: ProductComplianceDossier, as: 'dossiers', separate: true, limit: 1, order: [['revisionNumber', 'DESC']] }],
      },
    ];
    if (query.dossierStatus || query.complianceConclusion) {
      const allProducts = await Product.findAll({ where, include, order: [['status', 'ASC'], ['updatedAt', 'DESC']] });
      const filtered = allProducts.filter((product: any) => {
        const dossier = product.versions?.[0]?.dossiers?.[0];
        return (!query.dossierStatus || dossier?.lifecycleStatus === query.dossierStatus)
          && (!query.complianceConclusion || dossier?.complianceConclusion === query.complianceConclusion);
      });
      return {
        items: filtered.slice((page - 1) * pageSize, page * pageSize),
        pagination: pagination(page, pageSize, filtered.length),
      };
    }
    const { rows, count } = await Product.findAndCountAll({ where, include, order: [['status', 'ASC'], ['updatedAt', 'DESC']], limit: pageSize, offset: (page - 1) * pageSize, distinct: true });
    return { items: rows, pagination: pagination(page, pageSize, count) };
  }

  async getProduct(id: string, user: RequestUser) {
    await objectAccessService.productOrNotFound(id, user);
    return Product.findByPk(id, {
      include: [
        { model: ProductType, as: 'defaultProductType' },
        { model: ProductVersion, as: 'versions', include: [{ model: ProductType, as: 'productType' }, { model: ProductComplianceDossier, as: 'dossiers' }] },
      ],
      order: [[{ model: ProductVersion, as: 'versions' }, 'createdAt', 'DESC']],
    });
  }

  async createProduct(input: ProductInput, user: RequestUser) {
    const code = requiredText(input.code, '产品编码', 64).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(code)) throw new AppError(400, 'VALIDATION_ERROR', '产品编码只能包含大写字母、数字、下划线和连字符');
    await this.activeType(input.defaultProductTypeId);
    await this.validateOwners(input.ownerDepartmentId, input.ownerUserId, user);
    if (await Product.findOne({ where: { code } })) throw new AppError(409, 'CONFLICT', '产品编码已存在');
    const product = await Product.create({
      code,
      name: requiredText(input.name, '产品名称', 200),
      defaultProductTypeId: input.defaultProductTypeId,
      ownerUserId: input.ownerUserId,
      ownerDepartmentId: input.ownerDepartmentId,
      description: input.description?.trim() || null,
      createdBy: user.userId,
    });
    await this.log(user, 'product', product.id, `创建产品 ${product.code}`, OperationType.CREATE);
    return product;
  }

  async updateProduct(id: string, input: Partial<Omit<ProductInput, 'code'>>, user: RequestUser) {
    const product = await objectAccessService.productOrNotFound(id, user, 'update');
    if (product.status === 'archived') throw new AppError(409, 'PRODUCT_ARCHIVED', '已归档产品不可编辑');
    const ownerDepartmentId = input.ownerDepartmentId ?? product.ownerDepartmentId;
    const ownerUserId = input.ownerUserId ?? product.ownerUserId;
    await this.validateOwners(ownerDepartmentId, ownerUserId, user, id);
    if (input.defaultProductTypeId) await this.activeType(input.defaultProductTypeId);
    await product.update({
      ...(input.name !== undefined ? { name: requiredText(input.name, '产品名称', 200) } : {}),
      ...(input.defaultProductTypeId ? { defaultProductTypeId: input.defaultProductTypeId } : {}),
      ownerDepartmentId,
      ownerUserId,
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
    });
    await this.log(user, 'product', id, '更新产品资料');
    return product;
  }

  async archiveProduct(id: string, user: RequestUser) {
    const product = await objectAccessService.productOrNotFound(id, user, 'archive');
    if (product.status === 'active') await product.update({ status: 'archived', archivedAt: new Date() });
    await this.log(user, 'product', id, '归档产品');
    return product;
  }

  private async latestConfirmedDossier(productId: string, transaction: Transaction) {
    return ProductComplianceDossier.findOne({
      where: { lifecycleStatus: 'confirmed', isCurrentConfirmed: true },
      include: [{ model: ProductVersion, as: 'productVersion', where: { productId }, required: true }],
      order: [['confirmedAt', 'DESC']],
      transaction,
    });
  }

  private async createQuestionnaireAssignments(dossierId: string, productTypeId: string, userId: string, sourceDossierId: string | null, transaction: Transaction) {
    const rules = await ProductTypeQuestionnaireRule.findAll({
      where: { productTypeId, active: true },
      include: [{ model: ProductQuestionnaireTemplate, as: 'template', where: { status: 'active' }, required: true, include: [{ model: ProductQuestion, as: 'questions' }] }],
      transaction,
    });
    const sourceAnswers = sourceDossierId ? await ProductDossierAnswer.findAll({
      include: [{ model: ProductDossierQuestionnaire, as: 'questionnaire', where: { dossierId: sourceDossierId }, required: true }],
      transaction,
    }) : [];
    const answerMap = new Map(sourceAnswers.map((answer) => [answer.stableQuestionKey, answer]));
    for (const rule of rules) {
      const template = (rule as any).template as ProductQuestionnaireTemplate & { questions: ProductQuestion[] };
      const questions = (template as any).questions || [];
      const assignment = await ProductDossierQuestionnaire.create({
        dossierId,
        templateId: template.id,
        assignmentSource: 'rule',
        templateSnapshot: {
          seriesKey: template.seriesKey, name: template.name, version: template.version, required: rule.required,
          questions: questions.map((question: ProductQuestion) => ({ stableKey: question.stableKey, title: question.title, description: question.description, questionType: question.questionType, required: question.required, options: question.options, sortOrder: question.sortOrder })),
        },
      }, { transaction });
      for (const question of questions) {
        const source = answerMap.get(question.stableKey);
        await ProductDossierAnswer.create({
          dossierQuestionnaireId: assignment.id,
          questionId: question.id,
          stableQuestionKey: question.stableKey,
          response: source?.response ?? null,
          inheritedFromAnswerId: source?.id ?? null,
          inheritanceStatus: source ? 'inherited' : 'unanswered',
          updatedBy: userId,
        }, { transaction });
      }
    }
  }

  private async cloneDossierSections(sourceId: string, targetId: string, transaction: Transaction) {
    const [permissions, dataItems, activities, thirdPartyServices, thirdPartyAssessments] = await Promise.all([
      ProductPlatformPermission.findAll({ where: { dossierId: sourceId }, transaction }),
      ProductDataItem.findAll({ where: { dossierId: sourceId }, transaction }),
      ProductProcessingActivity.findAll({ where: { dossierId: sourceId }, transaction }),
      ProductThirdPartyService.findAll({ where: { dossierId: sourceId }, transaction }),
      ProductThirdPartyAssessment.findAll({ where: { dossierId: sourceId }, include: [{ model: ProductThirdPartyAssessmentAnswer, as: 'answers' }], transaction }),
    ]);
    const dataMap = new Map<string, string>();
    for (const item of dataItems) {
      const copy = await ProductDataItem.create({ ...(item.toJSON() as any), id: undefined, dossierId: targetId, inheritedFromDataItemId: item.id }, { transaction });
      dataMap.set(item.id, copy.id);
    }
    const permissionMap = new Map<string, string>();
    for (const permission of permissions) {
      const copy = await ProductPlatformPermission.create({ ...(permission.toJSON() as any), id: undefined, dossierId: targetId, inheritedFromPermissionId: permission.id }, { transaction });
      permissionMap.set(permission.id, copy.id);
    }
    const activityMap = new Map<string, string>();
    for (const activity of activities) {
      const copy = await ProductProcessingActivity.create({ ...(activity.toJSON() as any), id: undefined, dossierId: targetId, inheritedFromActivityId: activity.id }, { transaction });
      activityMap.set(activity.id, copy.id);
    }
    const serviceMap = new Map<string, string>();
    for (const service of thirdPartyServices) {
      const copy = await ProductThirdPartyService.create({ ...(service.toJSON() as any), id: undefined, dossierId: targetId, inheritedFromServiceId: service.id }, { transaction });
      serviceMap.set(service.id, copy.id);
    }
    for (const assessment of thirdPartyAssessments as Array<ProductThirdPartyAssessment & { answers?: ProductThirdPartyAssessmentAnswer[] }>) {
      const copy = await ProductThirdPartyAssessment.create({
        ...(assessment.toJSON() as any),
        id: undefined,
        dossierId: targetId,
        serviceId: assessment.serviceId ? serviceMap.get(assessment.serviceId) || null : null,
        inheritedFromAssessmentId: assessment.id,
      }, { transaction });
      for (const answer of (assessment as any).answers || []) {
        await ProductThirdPartyAssessmentAnswer.create({ ...(answer.toJSON() as any), id: undefined, assessmentId: copy.id }, { transaction });
      }
    }
    const [permissionLinks, activityLinks] = await Promise.all([
      ProductPermissionDataItem.findAll({ where: { permissionId: { [Op.in]: [...permissionMap.keys()] } }, transaction }),
      ProductProcessingDataItem.findAll({ where: { activityId: { [Op.in]: [...activityMap.keys()] } }, transaction }),
    ]);
    await ProductPermissionDataItem.bulkCreate(permissionLinks.flatMap((link) => {
      const permissionId = permissionMap.get(link.permissionId); const dataItemId = dataMap.get(link.dataItemId);
      return permissionId && dataItemId ? [{ permissionId, dataItemId }] : [];
    }), { transaction });
    await ProductProcessingDataItem.bulkCreate(activityLinks.flatMap((link) => {
      const activityId = activityMap.get(link.activityId); const dataItemId = dataMap.get(link.dataItemId);
      return activityId && dataItemId ? [{ activityId, dataItemId }] : [];
    }), { transaction });
  }

  async createVersion(productId: string, input: VersionInput, user: RequestUser) {
    const product = await objectAccessService.productOrNotFound(productId, user, 'update');
    if (product.status !== 'active') throw new AppError(409, 'PRODUCT_ARCHIVED', '已归档产品不能创建新版本');
    const result = await sequelize.transaction(async (transaction) => {
      const productTypeId = input.productTypeId || product.defaultProductTypeId;
      await this.activeType(productTypeId, transaction);
      const version = requiredText(input.version, '产品版本', 80);
      if (await ProductVersion.findOne({ where: { productId, version }, transaction })) throw new AppError(409, 'CONFLICT', '该产品版本已存在');
      const source = await this.latestConfirmedDossier(productId, transaction);
      const createdVersion = await ProductVersion.create({
        productId,
        version,
        productTypeId,
        platforms: cleanStrings(input.platforms),
        usageScope: requiredText(input.usageScope, '使用范围', 4000),
        plannedReleaseDate: input.plannedReleaseDate || null,
        actualReleaseDate: input.actualReleaseDate || null,
        changeDeclaration: input.changeDeclaration || {},
        createdBy: user.userId,
      }, { transaction });
      const dossier = await ProductComplianceDossier.create({
        productVersionId: createdVersion.id,
        sourceDossierId: source?.id || null,
        permissionsDeclared: source?.permissionsDeclared ?? null,
        personalDataDeclared: source?.personalDataDeclared ?? null,
        createdBy: user.userId,
      }, { transaction });
      await this.createQuestionnaireAssignments(dossier.id, productTypeId, user.userId, source?.id || null, transaction);
      if (source) await this.cloneDossierSections(source.id, dossier.id, transaction);
      return { version: createdVersion, dossier, inheritedFrom: source?.id || null };
    });
    await this.log(user, 'product_version', result.version.id, `创建产品版本 ${result.version.version}${result.inheritedFrom ? '并继承上一版档案草稿' : ''}`, OperationType.CREATE);
    return result;
  }

  async updateVersion(productId: string, versionId: string, input: Partial<VersionInput>, user: RequestUser) {
    await objectAccessService.productOrNotFound(productId, user, 'update');
    const version = await ProductVersion.findOne({ where: { id: versionId, productId } });
    if (!version) throw new AppError(404, 'NOT_FOUND', '产品版本不存在');
    const dossiers = await ProductComplianceDossier.findAll({ where: { productVersionId: versionId } });
    if (dossiers.some((dossier) => !['draft', 'changes_requested'].includes(dossier.lifecycleStatus))) {
      throw new AppError(409, 'VERSION_LOCKED', '档案提交后不能修改产品版本信息');
    }
    if (input.productTypeId && input.productTypeId !== version.productTypeId) {
      throw new AppError(409, 'PRODUCT_TYPE_LOCKED', '产品类型决定问卷组合，创建档案后不能直接修改；请创建新版本');
    }
    const nextVersion = input.version !== undefined ? requiredText(input.version, '产品版本', 80) : version.version;
    if (nextVersion !== version.version && await ProductVersion.findOne({ where: { productId, version: nextVersion, id: { [Op.ne]: versionId } } })) {
      throw new AppError(409, 'CONFLICT', '该产品版本已存在');
    }
    await version.update({
      version: nextVersion,
      ...(input.platforms !== undefined ? { platforms: cleanStrings(input.platforms) } : {}),
      ...(input.usageScope !== undefined ? { usageScope: requiredText(input.usageScope, '使用范围', 4000) } : {}),
      ...(input.plannedReleaseDate !== undefined ? { plannedReleaseDate: input.plannedReleaseDate || null } : {}),
      ...(input.actualReleaseDate !== undefined ? { actualReleaseDate: input.actualReleaseDate || null } : {}),
      ...(input.changeDeclaration !== undefined ? { changeDeclaration: input.changeDeclaration || {} } : {}),
    });
    await this.log(user, 'product_version', versionId, '更新产品版本资料');
    return version;
  }

  async deleteVersion(productId: string, versionId: string, user: RequestUser) {
    await objectAccessService.productOrNotFound(productId, user, 'update');
    await sequelize.transaction(async (transaction) => {
      const version = await ProductVersion.findOne({ where: { id: versionId, productId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!version) throw new AppError(404, 'NOT_FOUND', '产品版本不存在');
      const dossiers = await ProductComplianceDossier.findAll({ where: { productVersionId: versionId }, transaction });
      if (dossiers.some((dossier) => dossier.lifecycleStatus !== 'draft' || dossier.submittedAt)) {
        throw new AppError(409, 'VERSION_IN_USE', '只有从未提交的草稿版本可以删除');
      }
      await ProductComplianceDossier.destroy({ where: { productVersionId: versionId }, transaction });
      await version.destroy({ transaction });
    });
    await this.log(user, 'product_version', versionId, '删除未提交的产品版本', OperationType.DELETE);
  }

  private dossierInclude(): any[] {
    return [
      { model: ProductVersion, as: 'productVersion', include: [{ model: Product, as: 'product' }, { model: ProductType, as: 'productType' }] },
      { model: ProductDossierQuestionnaire, as: 'questionnaires', include: [{ model: ProductQuestionnaireTemplate, as: 'template' }, { model: ProductDossierAnswer, as: 'answers', include: [{ model: ProductQuestion, as: 'question' }] }] },
      { model: ProductPlatformPermission, as: 'platformPermissions', include: [{ model: ProductDataItem, as: 'dataItems', through: { attributes: [] } }] },
      { model: ProductDataItem, as: 'dataItems' },
      { model: ProductProcessingActivity, as: 'processingActivities', include: [{ model: ProductDataItem, as: 'dataItems', through: { attributes: [] } }] },
      { model: ProductThirdPartyService, as: 'thirdPartyServices' },
      { model: ProductThirdPartyAssessment, as: 'thirdPartyAssessments', include: [{ model: ProductThirdPartyService, as: 'service' }, { model: ProductThirdPartyAssessmentAnswer, as: 'answers' }] },
    ];
  }

  async getDossier(id: string, user: RequestUser) {
    await objectAccessService.dossierOrNotFound(id, user);
    return ProductComplianceDossier.findByPk(id, { include: this.dossierInclude() });
  }

  async listReviewQueue(query: Record<string, unknown>, user: RequestUser) {
    const { page, pageSize } = parsePagination(query as any);
    const productWhere = await objectAccessService.productScope(user, 'product_dossiers', 'review');
    const { rows, count } = await ProductComplianceDossier.findAndCountAll({
      where: { lifecycleStatus: 'pending_review', ...(query.reviewerId ? { reviewerId: query.reviewerId } : {}) },
      include: [{ model: ProductVersion, as: 'productVersion', required: true, include: [{ model: Product, as: 'product', required: true, where: productWhere }] }],
      order: [['submittedAt', 'ASC']], limit: pageSize, offset: (page - 1) * pageSize, distinct: true,
    });
    return { items: rows, pagination: pagination(page, pageSize, count) };
  }

  private async mutableDossier(id: string, user: RequestUser, expectedLockVersion: number, transaction: Transaction) {
    const dossier = await objectAccessService.dossierOrNotFound(id, user, 'update');
    assertLockVersion(dossier.lockVersion, expectedLockVersion);
    if (!['draft', 'changes_requested'].includes(dossier.lifecycleStatus)) throw new AppError(409, 'DOSSIER_LOCKED', '当前档案状态不可修改');
    const locked = await ProductComplianceDossier.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!locked) throw new AppError(404, 'NOT_FOUND', '产品合规档案不存在');
    assertLockVersion(locked.lockVersion, expectedLockVersion);
    return locked;
  }

  async saveAnswers(id: string, answers: Array<{ questionId: string; response: unknown }>, expectedLockVersion: number, user: RequestUser) {
    const dossier = await sequelize.transaction(async (transaction) => {
      const locked = await this.mutableDossier(id, user, expectedLockVersion, transaction);
      for (const input of answers || []) {
        const answer = await ProductDossierAnswer.findOne({ where: { questionId: input.questionId }, include: [{ model: ProductDossierQuestionnaire, as: 'questionnaire', where: { dossierId: id }, required: true }], transaction });
        if (!answer) throw new AppError(404, 'NOT_FOUND', '问卷题目不存在');
        await answer.update({ response: input.response ?? null, inheritanceStatus: answer.inheritedFromAnswerId ? 'modified' : (answerPresent(input.response) ? 'new' : 'unanswered'), updatedBy: user.userId, updatedAt: new Date() }, { transaction });
      }
      await locked.update({ lockVersion: locked.lockVersion + 1 }, { transaction });
      return locked;
    });
    await this.log(user, 'product_dossier', id, '保存产品合规问卷答案');
    return dossier;
  }

  async saveInventory(id: string, input: { permissionsDeclared: boolean; personalDataDeclared: boolean; permissions: any[]; dataItems: any[]; activities: any[]; thirdPartyServices?: any[]; thirdPartyAssessments?: any[] }, expectedLockVersion: number, user: RequestUser) {
    const dossier = await sequelize.transaction(async (transaction) => {
      const locked = await this.mutableDossier(id, user, expectedLockVersion, transaction);
      const permissions = Array.isArray(input.permissions) ? input.permissions : [];
      const dataItems = Array.isArray(input.dataItems) ? input.dataItems : [];
      const activities = Array.isArray(input.activities) ? input.activities : [];
      const thirdPartyServices = Array.isArray(input.thirdPartyServices) ? input.thirdPartyServices : [];
      const thirdPartyAssessments = Array.isArray(input.thirdPartyAssessments) ? input.thirdPartyAssessments : [];
      if (input.permissionsDeclared === false && permissions.length) throw new AppError(400, 'VALIDATION_ERROR', '声明未申请平台权限时不能保留权限项');
      if (input.personalDataDeclared === false && (dataItems.length || activities.length || thirdPartyServices.length || thirdPartyAssessments.length)) throw new AppError(400, 'VALIDATION_ERROR', '声明不处理个人数据时不能保留信息类型、ROPA或第三方清单');
      await ProductPermissionDataItem.destroy({ where: { permissionId: { [Op.in]: (await ProductPlatformPermission.findAll({ where: { dossierId: id }, attributes: ['id'], transaction })).map((item) => item.id) } }, transaction });
      await ProductProcessingDataItem.destroy({ where: { activityId: { [Op.in]: (await ProductProcessingActivity.findAll({ where: { dossierId: id }, attributes: ['id'], transaction })).map((item) => item.id) } }, transaction });
      const existingAssessmentIds = (await ProductThirdPartyAssessment.findAll({ where: { dossierId: id }, attributes: ['id'], transaction })).map((item) => item.id);
      if (existingAssessmentIds.length) await ProductThirdPartyAssessmentAnswer.destroy({ where: { assessmentId: { [Op.in]: existingAssessmentIds } }, transaction });
      await ProductThirdPartyAssessment.destroy({ where: { dossierId: id }, transaction });
      await ProductThirdPartyService.destroy({ where: { dossierId: id }, transaction });
      await ProductPlatformPermission.destroy({ where: { dossierId: id }, transaction });
      await ProductProcessingActivity.destroy({ where: { dossierId: id }, transaction });
      await ProductDataItem.destroy({ where: { dossierId: id }, transaction });
      const clientDataMap = new Map<string, string>();
      for (const [index, item] of dataItems.entries()) {
        const created = await ProductDataItem.create({
          dossierId: id, name: requiredText(item.name, '信息名称', 160), category: requiredText(item.category, '信息类别', 120), dataSubjectCategories: cleanStrings(item.dataSubjectCategories), source: item.source?.trim() || null,
          catalogItemId: item.catalogItemId || null, purpose: optionalText(item.purpose), necessity: optionalText(item.necessity, 40), processingMethod: optionalText(item.processingMethod, 160), operatingSystems: cleanStrings(item.operatingSystems),
          sensitive: Boolean(item.sensitive), required: Boolean(item.required), notes: item.notes?.trim() || null,
          inheritedFromDataItemId: item.inheritedFromDataItemId || null, sortOrder: index,
        }, { transaction });
        clientDataMap.set(String(item.clientId || item.id || index), created.id);
      }
      for (const [index, item] of permissions.entries()) {
        const permission = await ProductPlatformPermission.create({ dossierId: id, platform: requiredText(item.platform, '平台', 50), operatingSystem: optionalText(item.operatingSystem, 80), permissionName: requiredText(item.permissionName, '权限名称', 160), purpose: requiredText(item.purpose, '权限用途', 4000), required: Boolean(item.required), inheritedFromPermissionId: item.inheritedFromPermissionId || null, sortOrder: index }, { transaction });
        const linkedIds = cleanStrings(item.dataItemIds);
        if (linkedIds.some((clientId) => !clientDataMap.has(clientId))) throw new AppError(400, 'VALIDATION_ERROR', '平台权限关联了不存在的信息类型');
        await ProductPermissionDataItem.bulkCreate(linkedIds.map((clientId) => ({ permissionId: permission.id, dataItemId: clientDataMap.get(clientId)! })), { transaction });
      }
      for (const [index, item] of activities.entries()) {
        const linkedIds = cleanStrings(item.dataItemIds);
        if (!linkedIds.length || linkedIds.some((clientId) => !clientDataMap.has(clientId))) throw new AppError(400, 'VALIDATION_ERROR', 'ROPA处理活动必须关联有效的信息类型');
        const transferCountries = cleanStrings(item.transferCountries);
        if (item.internationalTransfer && (!transferCountries.length || !item.transferSafeguards?.trim())) throw new AppError(400, 'VALIDATION_ERROR', '跨境处理活动必须填写目的国家/地区和保障措施');
        const activity = await ProductProcessingActivity.create({
          dossierId: id, name: requiredText(item.name, '处理活动名称', 200), purpose: requiredText(item.purpose, '处理目的', 4000), legalBasis: requiredText(item.legalBasis, '法律依据', 160), controllerRole: item.controllerRole || 'controller',
          dataSubjectCategories: cleanStrings(item.dataSubjectCategories), recipientCategories: cleanStrings(item.recipientCategories), internationalTransfer: Boolean(item.internationalTransfer), transferCountries, transferSafeguards: item.transferSafeguards?.trim() || null,
          dataSource: optionalText(item.dataSource), writesToLog: optionalBoolean(item.writesToLog), dataScale: optionalText(item.dataScale), transferPath: optionalText(item.transferPath), transferEncryption: optionalText(item.transferEncryption), thirdPartyProcessor: optionalText(item.thirdPartyProcessor),
          thirdPartyProcessingAgreement: optionalBoolean(item.thirdPartyProcessingAgreement), stored: optionalBoolean(item.stored), storageSystem: optionalText(item.storageSystem), storageLocation: optionalText(item.storageLocation), storageEncryption: optionalText(item.storageEncryption), accessControl: optionalText(item.accessControl),
          anonymization: optionalText(item.anonymization), systemLogging: optionalText(item.systemLogging), bulkExportAllowed: optionalBoolean(item.bulkExportAllowed),
          retentionPeriod: requiredText(item.retentionPeriod, '删除或保存期限', 4000), deletionMechanism: optionalText(item.deletionMechanism), retentionBasis: optionalText(item.retentionBasis), securityMeasures: requiredText(item.securityMeasures, '安全措施', 4000), responsibleParty: requiredText(item.responsibleParty, '责任主体', 200), inheritedFromActivityId: item.inheritedFromActivityId || null, sortOrder: index,
        }, { transaction });
        await ProductProcessingDataItem.bulkCreate(linkedIds.map((clientId) => ({ activityId: activity.id, dataItemId: clientDataMap.get(clientId)! })), { transaction });
      }
      const clientServiceMap = new Map<string, string>();
      for (const [index, item] of thirdPartyServices.entries()) {
        const service = await ProductThirdPartyService.create({
          dossierId: id,
          serviceName: requiredText(item.serviceName, '第三方服务名称', 200),
          purpose: requiredText(item.purpose, '第三方使用目的', 4000),
          sharedFields: cleanStrings(item.sharedFields),
          thirdPartyName: optionalText(item.thirdPartyName, 200),
          securityMethod: optionalText(item.securityMethod),
          privacyPolicyUrl: optionalText(item.privacyPolicyUrl),
          assessmentPassed: optionalBoolean(item.assessmentPassed),
          assessmentRecord: optionalText(item.assessmentRecord),
          inheritedFromServiceId: item.inheritedFromServiceId || null,
          sortOrder: index,
        }, { transaction });
        clientServiceMap.set(String(item.clientId || item.id || index), service.id);
      }
      for (const [index, item] of thirdPartyAssessments.entries()) {
        const serviceId = item.serviceClientId || item.serviceId;
        if (serviceId && !clientServiceMap.has(String(serviceId))) throw new AppError(400, 'VALIDATION_ERROR', '第三方安全评审关联了不存在的第三方服务');
        const assessment = await ProductThirdPartyAssessment.create({
          dossierId: id,
          serviceId: serviceId ? clientServiceMap.get(String(serviceId)) || null : null,
          templateKey: optionalText(item.templateKey, 120) || 'third-party-security-v1',
          title: requiredText(item.title || '第三方信息安全和隐私合规自检表', '第三方评审标题', 200),
          inheritedFromAssessmentId: item.inheritedFromAssessmentId || null,
          sortOrder: index,
        }, { transaction });
        const answers = Array.isArray(item.answers) && item.answers.length
          ? item.answers
          : THIRD_PARTY_ASSESSMENT_ITEMS.map((answer) => ({ ...answer, item: answer.title, answer: null, explanation: null, evidence: null }));
        for (const [answerIndex, answer] of answers.entries()) {
          await ProductThirdPartyAssessmentAnswer.create({
            assessmentId: assessment.id,
            stableKey: requiredText(answer.stableKey || `third_party_${answerIndex + 1}`, '第三方评审题目标识', 120),
            section: optionalText(answer.section, 200),
            sequence: optionalText(answer.sequence, 40),
            item: requiredText(answer.item || answer.title, '第三方评估项', 4000),
            answer: optionalText(answer.answer, 40),
            explanation: optionalText(answer.explanation),
            evidence: optionalText(answer.evidence),
            sortOrder: answerIndex,
          }, { transaction });
        }
      }
      await locked.update({ permissionsDeclared: input.permissionsDeclared, personalDataDeclared: input.personalDataDeclared, lockVersion: locked.lockVersion + 1 }, { transaction });
      return locked;
    });
    await this.log(user, 'product_dossier', id, '保存平台权限、信息类型、ROPA和第三方清单');
    return dossier;
  }

  async adjustQuestionnaires(id: string, input: { templateIds: string[]; reason: string }, expectedLockVersion: number, user: RequestUser) {
    const reason = requiredText(input.reason, '问卷调整原因', 2000);
    const templateIds = cleanStrings(input.templateIds);
    const dossier = await sequelize.transaction(async (transaction) => {
      const locked = await this.mutableDossier(id, user, expectedLockVersion, transaction);
      const current = await ProductDossierQuestionnaire.findAll({ where: { dossierId: id }, transaction });
      const remove = current.filter((assignment) => !templateIds.includes(assignment.templateId));
      if (remove.length) await ProductDossierQuestionnaire.destroy({ where: { id: { [Op.in]: remove.map((item) => item.id) } }, transaction });
      for (const templateId of templateIds.filter((templateId) => !current.some((item) => item.templateId === templateId))) {
        const template = await ProductQuestionnaireTemplate.findOne({ where: { id: templateId, status: 'active' }, include: [{ model: ProductQuestion, as: 'questions' }], transaction });
        if (!template) throw new AppError(404, 'NOT_FOUND', '选择的问卷模板不存在或未启用');
        const questions = (template as any).questions || [];
        const assignment = await ProductDossierQuestionnaire.create({ dossierId: id, templateId, assignmentSource: 'manual', adjustmentReason: reason, templateSnapshot: { seriesKey: template.seriesKey, name: template.name, version: template.version, questions: questions.map((question: any) => ({ stableKey: question.stableKey, title: question.title, description: question.description, questionType: question.questionType, required: question.required, options: question.options, sortOrder: question.sortOrder })) } }, { transaction });
        for (const question of questions) await ProductDossierAnswer.create({ dossierQuestionnaireId: assignment.id, questionId: question.id, stableQuestionKey: question.stableKey, response: null, inheritanceStatus: 'unanswered', updatedBy: user.userId }, { transaction });
      }
      for (const assignment of current.filter((item) => templateIds.includes(item.templateId))) await assignment.update({ adjustmentReason: reason }, { transaction });
      await locked.update({ lockVersion: locked.lockVersion + 1 }, { transaction });
      return locked;
    });
    await this.log(user, 'product_dossier', id, `调整适用问卷：${reason}`);
    return dossier;
  }

  private async validateForSubmission(id: string, transaction: Transaction) {
    const dossier = await ProductComplianceDossier.findByPk(id, { include: this.dossierInclude(), transaction });
    if (!dossier) throw new AppError(404, 'NOT_FOUND', '产品合规档案不存在');
    const errors: string[] = [];
    const questionnaires = (dossier as any).questionnaires || [];
    for (const assignment of questionnaires) for (const answer of assignment.answers || []) {
      if (answer.question?.required && !answerPresent(answer.response)) errors.push(`必答题未填写：${answer.question.title}`);
    }
    if (dossier.permissionsDeclared === null) errors.push('请明确是否申请平台权限');
    if (dossier.permissionsDeclared === true && !(dossier as any).platformPermissions?.length) errors.push('已声明申请平台权限，请至少填写一项权限');
    if (dossier.personalDataDeclared === null) errors.push('请明确是否处理个人数据');
    if (dossier.personalDataDeclared === true && !(dossier as any).dataItems?.length) errors.push('已声明处理个人数据，请至少填写一种信息类型');
    if (dossier.personalDataDeclared === true && !(dossier as any).processingActivities?.length) errors.push('已声明处理个人数据，请至少填写一项ROPA处理活动');
    if ((dossier as any).thirdPartyServices?.some((service: any) => service.assessmentPassed === null || service.assessmentPassed === undefined)) errors.push('第三方清单需明确是否通过第三方评审');
    if ((dossier as any).thirdPartyServices?.length && !(dossier as any).thirdPartyAssessments?.length) errors.push('已填写第三方清单，请至少保留一份第三方安全评审记录');
    if (!dossier.proposedConclusion || dossier.proposedConclusion === 'not_assessed') errors.push('请填写拟定合规结论');
    if (errors.length) throw new AppError(400, 'DOSSIER_INCOMPLETE', '档案尚未填写完整', { errors });
    return dossier;
  }

  async updateOverview(id: string, input: { proposedConclusion: DossierComplianceConclusion; reviewerId?: string | null }, expectedLockVersion: number, user: RequestUser) {
    if (!CONCLUSIONS.includes(input.proposedConclusion)) throw new AppError(400, 'VALIDATION_ERROR', '合规结论无效');
    const dossier = await sequelize.transaction(async (transaction) => {
      const locked = await this.mutableDossier(id, user, expectedLockVersion, transaction);
      await locked.update({ proposedConclusion: input.proposedConclusion, reviewerId: input.reviewerId || null, lockVersion: locked.lockVersion + 1 }, { transaction });
      return locked;
    });
    await this.log(user, 'product_dossier', id, '更新档案概览');
    return dossier;
  }

  async submit(id: string, expectedLockVersion: number, user: RequestUser) {
    const dossier = await sequelize.transaction(async (transaction) => {
      const locked = await this.mutableDossier(id, user, expectedLockVersion, transaction);
      await this.validateForSubmission(id, transaction);
      await locked.update({ lifecycleStatus: 'pending_review', submittedBy: user.userId, submittedAt: new Date(), returnReason: null, lockVersion: locked.lockVersion + 1 }, { transaction });
      return locked;
    });
    await this.log(user, 'product_dossier', id, '提交产品合规档案复核');
    return dossier;
  }

  async returnForChanges(id: string, reason: string, expectedLockVersion: number, user: RequestUser) {
    const dossier = await sequelize.transaction(async (transaction) => {
      const accessible = await objectAccessService.dossierOrNotFound(id, user, 'review');
      assertLockVersion(accessible.lockVersion, expectedLockVersion);
      const locked = await ProductComplianceDossier.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!locked || locked.lifecycleStatus !== 'pending_review') throw new AppError(409, 'INVALID_STATUS', '只有待复核档案可以退回');
      assertLockVersion(locked.lockVersion, expectedLockVersion);
      if (locked.submittedBy === user.userId) throw new AppError(409, 'SELF_REVIEW_FORBIDDEN', '不能复核本人提交的档案');
      await locked.update({ lifecycleStatus: 'changes_requested', reviewerId: user.userId, returnReason: requiredText(reason, '退回原因', 4000), lockVersion: locked.lockVersion + 1 }, { transaction });
      return locked;
    });
    await this.log(user, 'product_dossier', id, `退回产品合规档案：${reason}`);
    return dossier;
  }

  async confirm(id: string, conclusion: DossierComplianceConclusion, expectedLockVersion: number, user: RequestUser) {
    if (!CONCLUSIONS.includes(conclusion) || conclusion === 'not_assessed') throw new AppError(400, 'VALIDATION_ERROR', '确认时必须选择有效合规结论');
    const dossier = await sequelize.transaction(async (transaction) => {
      const accessible = await objectAccessService.dossierOrNotFound(id, user, 'confirm');
      assertLockVersion(accessible.lockVersion, expectedLockVersion);
      const locked = await ProductComplianceDossier.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!locked || locked.lifecycleStatus !== 'pending_review') throw new AppError(409, 'INVALID_STATUS', '只有待复核档案可以确认');
      assertLockVersion(locked.lockVersion, expectedLockVersion);
      if (locked.submittedBy === user.userId) throw new AppError(409, 'SELF_REVIEW_FORBIDDEN', '不能确认本人提交的档案');
      const version = await ProductVersion.findByPk(locked.productVersionId, { transaction });
      if (!version) throw new AppError(404, 'NOT_FOUND', '产品版本不存在');
      const priorConfirmed = await ProductComplianceDossier.findAll({
        where: { lifecycleStatus: 'confirmed', isCurrentConfirmed: true, id: { [Op.ne]: id } },
        include: [{ model: ProductVersion, as: 'productVersion', where: { productId: version.productId }, required: true }], transaction,
      });
      for (const prior of priorConfirmed) await prior.update({ isCurrentConfirmed: false }, { transaction });
      if (locked.supersedesDossierId) await ProductComplianceDossier.update({ lifecycleStatus: 'superseded', isCurrentConfirmed: false }, { where: { id: locked.supersedesDossierId }, transaction });
      await locked.update({ lifecycleStatus: 'confirmed', complianceConclusion: conclusion, reviewerId: user.userId, confirmedBy: user.userId, confirmedAt: new Date(), isCurrentConfirmed: true, lockVersion: locked.lockVersion + 1 }, { transaction });
      return locked;
    });
    await this.log(user, 'product_dossier', id, `确认产品合规档案，结论：${conclusion}`);
    return dossier;
  }

  async revise(id: string, user: RequestUser) {
    const source = await objectAccessService.dossierOrNotFound(id, user, 'revise');
    if (source.lifecycleStatus !== 'confirmed') throw new AppError(409, 'INVALID_STATUS', '只有已确认档案可以发起修订');
    const revised = await sequelize.transaction(async (transaction) => {
      const maxRevision = await ProductComplianceDossier.max('revisionNumber', { where: { productVersionId: source.productVersionId }, transaction });
      const dossier = await ProductComplianceDossier.create({
        productVersionId: source.productVersionId,
        revisionNumber: Number(maxRevision || 0) + 1,
        supersedesDossierId: source.id,
        sourceDossierId: source.id,
        permissionsDeclared: source.permissionsDeclared,
        personalDataDeclared: source.personalDataDeclared,
        proposedConclusion: source.complianceConclusion,
        createdBy: user.userId,
      }, { transaction });
      const assignments = await ProductDossierQuestionnaire.findAll({ where: { dossierId: source.id }, include: [{ model: ProductDossierAnswer, as: 'answers' }], transaction });
      for (const assignment of assignments) {
        const copy = await ProductDossierQuestionnaire.create({ dossierId: dossier.id, templateId: assignment.templateId, assignmentSource: assignment.assignmentSource, adjustmentReason: assignment.adjustmentReason, templateSnapshot: assignment.templateSnapshot }, { transaction });
        for (const answer of (assignment as any).answers || []) await ProductDossierAnswer.create({ dossierQuestionnaireId: copy.id, questionId: answer.questionId, stableQuestionKey: answer.stableQuestionKey, response: answer.response, inheritedFromAnswerId: answer.id, inheritanceStatus: 'inherited', updatedBy: user.userId }, { transaction });
      }
      await this.cloneDossierSections(source.id, dossier.id, transaction);
      return dossier;
    });
    await this.log(user, 'product_dossier', revised.id, `基于修订 ${source.revisionNumber} 创建修订 ${revised.revisionNumber}`, OperationType.CREATE);
    return revised;
  }

  async inheritanceDiff(id: string, user: RequestUser) {
    const dossier = await this.getDossier(id, user) as any;
    if (!dossier) throw new AppError(404, 'NOT_FOUND', '产品合规档案不存在');
    const answers = (dossier.questionnaires || []).flatMap((item: any) => item.answers || []);
    return {
      sourceDossierId: dossier.sourceDossierId,
      answers: {
        inherited: answers.filter((answer: any) => answer.inheritanceStatus === 'inherited').length,
        modified: answers.filter((answer: any) => answer.inheritanceStatus === 'modified').length,
        new: answers.filter((answer: any) => ['new', 'unanswered'].includes(answer.inheritanceStatus)).length,
      },
      permissions: (dossier.platformPermissions || []).map((item: any) => ({ id: item.id, inherited: Boolean(item.inheritedFromPermissionId), name: item.permissionName })),
      dataItems: (dossier.dataItems || []).map((item: any) => ({ id: item.id, inherited: Boolean(item.inheritedFromDataItemId), name: item.name })),
      activities: (dossier.processingActivities || []).map((item: any) => ({ id: item.id, inherited: Boolean(item.inheritedFromActivityId), name: item.name })),
      thirdPartyServices: (dossier.thirdPartyServices || []).map((item: any) => ({ id: item.id, inherited: Boolean(item.inheritedFromServiceId), name: item.serviceName })),
      thirdPartyAssessments: (dossier.thirdPartyAssessments || []).map((item: any) => ({ id: item.id, inherited: Boolean(item.inheritedFromAssessmentId), name: item.title })),
    };
  }

  async listProductTypes(includeRetired = false) {
    return ProductType.findAll({ where: includeRetired ? {} : { status: 'active' }, order: [['status', 'ASC'], ['name', 'ASC']] });
  }

  async listDataCatalog(includeRetired = false) {
    return ProductDataCatalogItem.findAll({ where: includeRetired ? {} : { status: 'active' }, order: [['sortOrder', 'ASC'], ['category', 'ASC'], ['name', 'ASC']] });
  }

  async exportDossier(id: string, user: RequestUser) {
    const dossier = await this.getDossier(id, user) as any;
    if (!dossier) throw new AppError(404, 'NOT_FOUND', '产品合规档案不存在');
    const productTypeCode = dossier.productVersion?.productType?.code || '';
    const prefix = productTypeCode === 'APP' ? 'APP' : 'SDK';
    const workbook = new ExcelJS.Workbook();
    workbook.creator = user.username || user.userId;
    workbook.created = new Date();

    const overview = workbook.addWorksheet('导出信息');
    overview.addRows([
      ['产品', dossier.productVersion?.product?.name || ''],
      ['版本', dossier.productVersion?.version || ''],
      ['产品类型', dossier.productVersion?.productType?.name || ''],
      ['档案修订', `R${dossier.revisionNumber}`],
      ['流程状态', dossier.lifecycleStatus],
      ['确认结论', dossier.complianceConclusion],
      ['导出时间', new Date().toISOString()],
      ['数据来源', '系统产品合规模块只读导出'],
    ]);
    overview.getColumn(1).width = 20;
    overview.getColumn(2).width = 80;

    const questionnaireSheet = workbook.addWorksheet('合规问卷 - 基础问题');
    questionnaireSheet.columns = [
      { header: '号', key: 'no', width: 10 },
      { header: '合规评审问题', key: 'question', width: 60 },
      { header: '需求方回答反馈 & 说明', key: 'answer', width: 60 },
      { header: '安全合规填写', key: 'notes', width: 40 },
    ];
    const appSheet = productTypeCode === 'APP' ? workbook.addWorksheet('APP合规问卷') : null;
    if (appSheet) {
      appSheet.columns = [
        { header: '领域', key: 'domain', width: 32 },
        { header: '安全合规要求 Checklist', key: 'question', width: 70 },
        { header: '请勾选是否满足', key: 'answer', width: 18 },
        { header: '备注', key: 'notes', width: 42 },
      ];
    }
    for (const assignment of dossier.questionnaires || []) {
      const snapshot = assignment.templateSnapshot || {};
      const target = snapshot.seriesKey === 'app-compliance-checklist' && appSheet ? appSheet : questionnaireSheet;
      for (const answer of assignment.answers || []) {
        const question = answer.question || {};
        target.addRow({
          no: question.stableKey || answer.stableQuestionKey,
          domain: question.description?.split('\n')[0] || '',
          question: question.title || '',
          answer: displayValue(answer.response),
          notes: question.description || '',
        });
      }
    }
    styleExportSheet(questionnaireSheet);
    if (appSheet) styleExportSheet(appSheet);

    const permissionSheet = workbook.addWorksheet(`${prefix}信息收集&权限基本信息`);
    permissionSheet.columns = [
      { header: '类型', key: 'kind', width: 14 },
      { header: '个人信息类型/权限类型', key: 'name', width: 30 },
      { header: '目的和用途', key: 'purpose', width: 42 },
      { header: '必要或可选', key: 'necessity', width: 16 },
      { header: '处理方式', key: 'method', width: 24 },
      { header: '操作系统', key: 'os', width: 22 },
    ];
    for (const item of dossier.dataItems || []) permissionSheet.addRow({
      kind: '个人信息',
      name: item.name,
      purpose: item.purpose || '',
      necessity: item.necessity || (item.required ? '必要' : '可选'),
      method: item.processingMethod || '',
      os: displayValue(item.operatingSystems),
    });
    for (const permission of dossier.platformPermissions || []) permissionSheet.addRow({
      kind: '权限',
      name: permission.permissionName,
      purpose: permission.purpose,
      necessity: permission.required ? '必选' : '可选',
      method: '',
      os: permission.operatingSystem || permission.platform,
    });
    styleExportSheet(permissionSheet);

    const dataSheet = workbook.addWorksheet('个人信息收集情况');
    dataSheet.columns = [
      { header: '是否收集', key: 'collected', width: 12 },
      { header: '个人信息主体', key: 'subject', width: 24 },
      { header: '信息分类', key: 'category', width: 24 },
      { header: '具体信息项', key: 'name', width: 28 },
      { header: '是否敏感', key: 'sensitive', width: 12 },
      { header: '用途', key: 'purpose', width: 40 },
      { header: '备注', key: 'notes', width: 36 },
    ];
    for (const item of dossier.dataItems || []) dataSheet.addRow({
      collected: '是',
      subject: displayValue(item.dataSubjectCategories),
      category: item.category,
      name: item.name,
      sensitive: item.sensitive ? '是' : '否',
      purpose: item.purpose || '',
      notes: item.notes || '',
    });
    styleExportSheet(dataSheet);

    const ropaSheet = workbook.addWorksheet('RoPA(数据处理记录)');
    ropaSheet.columns = [
      { header: '数据主体', key: 'subjects', width: 24 },
      { header: '数据类型', key: 'types', width: 30 },
      { header: '字段', key: 'fields', width: 30 },
      { header: '属于个人敏感数据', key: 'sensitive', width: 18 },
      { header: '数据来源/收集方式', key: 'source', width: 32 },
      { header: '个人数据收集/处理合法依据？', key: 'basis', width: 30 },
      { header: '个人数据处理角色', key: 'role', width: 24 },
      { header: '数据收集/处理目的', key: 'purpose', width: 42 },
      { header: '是否写入日志', key: 'writesToLog', width: 16 },
      { header: '数据规模', key: 'scale', width: 24 },
      { header: '数据传输路径', key: 'transferPath', width: 42 },
      { header: '数据传输加密措施', key: 'transferEncryption', width: 36 },
      { header: '第三方名称', key: 'thirdParty', width: 24 },
      { header: '是否签署数据处理协议', key: 'agreement', width: 20 },
      { header: '数据是否存储', key: 'stored', width: 16 },
      { header: '数据存储系统/第三方平台等', key: 'storageSystem', width: 32 },
      { header: '数据存储国家/区域', key: 'storageLocation', width: 24 },
      { header: '数据存储加密措施', key: 'storageEncryption', width: 32 },
      { header: '访问控制/权限控制措施', key: 'accessControl', width: 36 },
      { header: '数据脱敏/匿名化控制措施', key: 'anonymization', width: 36 },
      { header: '系统是否记录日志？', key: 'logging', width: 24 },
      { header: '允许批量数据下载/导出？', key: 'bulkExport', width: 24 },
      { header: '数据留存期限？', key: 'retention', width: 28 },
      { header: '数据删除机制？', key: 'deletion', width: 28 },
      { header: '数据留存原因/依据', key: 'retentionBasis', width: 28 },
    ];
    for (const activity of dossier.processingActivities || []) ropaSheet.addRow({
      subjects: displayValue(activity.dataSubjectCategories),
      types: (activity.dataItems || []).map((item: any) => item.category).join('；'),
      fields: (activity.dataItems || []).map((item: any) => item.name).join('；'),
      sensitive: (activity.dataItems || []).some((item: any) => item.sensitive) ? '是' : '否',
      source: activity.dataSource || '',
      basis: activity.legalBasis,
      role: activity.controllerRole,
      purpose: activity.purpose,
      writesToLog: displayValue(activity.writesToLog),
      scale: activity.dataScale || '',
      transferPath: activity.transferPath || '',
      transferEncryption: activity.transferEncryption || '',
      thirdParty: activity.thirdPartyProcessor || '',
      agreement: displayValue(activity.thirdPartyProcessingAgreement),
      stored: displayValue(activity.stored),
      storageSystem: activity.storageSystem || '',
      storageLocation: activity.storageLocation || '',
      storageEncryption: activity.storageEncryption || '',
      accessControl: activity.accessControl || '',
      anonymization: activity.anonymization || '',
      logging: activity.systemLogging || '',
      bulkExport: displayValue(activity.bulkExportAllowed),
      retention: activity.retentionPeriod,
      deletion: activity.deletionMechanism || '',
      retentionBasis: activity.retentionBasis || '',
    });
    styleExportSheet(ropaSheet);

    const thirdPartySheet = workbook.addWorksheet('第三方清单');
    thirdPartySheet.columns = [
      { header: '服务名称', key: 'serviceName', width: 30 },
      { header: '使用目的和用途', key: 'purpose', width: 42 },
      { header: '信息共享字段', key: 'sharedFields', width: 36 },
      { header: '第三方名称', key: 'thirdPartyName', width: 28 },
      { header: '安全处理方式', key: 'securityMethod', width: 32 },
      { header: '第三方隐私政策链接', key: 'privacyPolicyUrl', width: 36 },
      { header: '是否通过第三方评审', key: 'assessmentPassed', width: 20 },
      { header: '第三方安全评审记录', key: 'assessmentRecord', width: 36 },
    ];
    for (const service of dossier.thirdPartyServices || []) thirdPartySheet.addRow({
      serviceName: service.serviceName,
      purpose: service.purpose,
      sharedFields: displayValue(service.sharedFields),
      thirdPartyName: service.thirdPartyName || '',
      securityMethod: service.securityMethod || '',
      privacyPolicyUrl: service.privacyPolicyUrl || '',
      assessmentPassed: displayValue(service.assessmentPassed),
      assessmentRecord: service.assessmentRecord || '',
    });
    styleExportSheet(thirdPartySheet);

    const assessmentSheet = workbook.addWorksheet('第三方安全评审模板');
    assessmentSheet.columns = [
      { header: '第三方服务', key: 'service', width: 26 },
      { header: '序号', key: 'sequence', width: 10 },
      { header: '评估项', key: 'item', width: 72 },
      { header: '回答（是/否/不适用）', key: 'answer', width: 20 },
      { header: '补充/解释说明', key: 'explanation', width: 42 },
      { header: '相关文件/证明材料', key: 'evidence', width: 36 },
    ];
    for (const assessment of dossier.thirdPartyAssessments || []) for (const answer of assessment.answers || []) assessmentSheet.addRow({
      service: assessment.service?.serviceName || '',
      sequence: answer.sequence || '',
      item: answer.item,
      answer: answer.answer || '',
      explanation: answer.explanation || '',
      evidence: answer.evidence || '',
    });
    styleExportSheet(assessmentSheet);

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async createProductType(input: any, user: RequestUser) {
    const code = requiredText(input.code, '类型编码', 64).toUpperCase();
    if (await ProductType.findOne({ where: { code } })) throw new AppError(409, 'CONFLICT', '产品类型编码已存在');
    const type = await ProductType.create({ code, name: requiredText(input.name, '类型名称', 120), description: input.description?.trim() || null, createdBy: user.userId });
    await this.log(user, 'product_type', type.id, `创建产品类型 ${type.name}`, OperationType.CREATE);
    return type;
  }

  async updateProductType(id: string, input: any, user: RequestUser) {
    const type = await ProductType.findByPk(id);
    if (!type) throw new AppError(404, 'NOT_FOUND', '产品类型不存在');
    if (input.status && !['active', 'retired'].includes(input.status)) throw new AppError(400, 'VALIDATION_ERROR', '产品类型状态无效');
    await type.update({ ...(input.name !== undefined ? { name: requiredText(input.name, '类型名称', 120) } : {}), ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}), ...(input.status ? { status: input.status } : {}) });
    await this.log(user, 'product_type', id, input.status === 'retired' ? '停用产品类型' : '更新产品类型');
    return type;
  }

  async listTemplates(includeRetired = false) {
    return ProductQuestionnaireTemplate.findAll({ where: includeRetired ? {} : { status: { [Op.ne]: 'retired' } }, include: [{ model: ProductQuestion, as: 'questions' }], order: [['createdAt', 'DESC'], [{ model: ProductQuestion, as: 'questions' }, 'sortOrder', 'ASC']] });
  }

  async createTemplate(input: any, user: RequestUser) {
    const questions = Array.isArray(input.questions) ? input.questions : [];
    const stableKeys = questions.map((item: any) => requiredText(item.stableKey, '稳定题目标识', 120));
    if (new Set(stableKeys).size !== stableKeys.length) throw new AppError(409, 'DUPLICATE_QUESTION_KEY', '稳定题目标识不能重复');
    const seriesKey = requiredText(input.seriesKey, '问卷系列标识', 100);
    const version = requiredText(input.version, '问卷版本', 50);
    if (await ProductQuestionnaireTemplate.findOne({ where: { seriesKey, version } })) throw new AppError(409, 'CONFLICT', '该问卷系列版本已存在');
    const template = await sequelize.transaction(async (transaction) => {
      const created = await ProductQuestionnaireTemplate.create({ seriesKey, name: requiredText(input.name, '问卷名称', 200), description: input.description?.trim() || null, version, status: input.status === 'active' ? 'active' : 'draft', publishedAt: input.status === 'active' ? new Date() : null, createdBy: user.userId }, { transaction });
      for (const [index, question] of questions.entries()) {
        if (!QUESTION_TYPES.includes(question.questionType)) throw new AppError(400, 'VALIDATION_ERROR', '问题类型无效');
        await ProductQuestion.create({ templateId: created.id, stableKey: stableKeys[index], title: requiredText(question.title, '问题标题', 4000), description: question.description?.trim() || null, questionType: question.questionType, required: Boolean(question.required), options: Array.isArray(question.options) ? question.options : [], sortOrder: index }, { transaction });
      }
      return created;
    });
    await this.log(user, 'product_questionnaire_template', template.id, `创建问卷模板 ${template.name} ${template.version}`, OperationType.CREATE);
    return this.getTemplate(template.id);
  }

  async getTemplate(id: string) {
    const template = await ProductQuestionnaireTemplate.findByPk(id, { include: [{ model: ProductQuestion, as: 'questions' }] });
    if (!template) throw new AppError(404, 'NOT_FOUND', '问卷模板不存在');
    return template;
  }

  async updateTemplate(id: string, input: any, user: RequestUser) {
    const template = await ProductQuestionnaireTemplate.findByPk(id);
    if (!template) throw new AppError(404, 'NOT_FOUND', '问卷模板不存在');
    if (input.status && !['draft', 'active', 'retired'].includes(input.status)) throw new AppError(400, 'VALIDATION_ERROR', '问卷状态无效');
    if (template.status !== 'draft' && (input.questions || input.name || input.version || input.seriesKey)) throw new AppError(409, 'TEMPLATE_IMMUTABLE', '已启用问卷不可修改内容，请创建新版本');
    await sequelize.transaction(async (transaction) => {
      if (template.status === 'draft' && input.questions) {
        const stableKeys = input.questions.map((question: any) => requiredText(question.stableKey, '稳定题目标识', 120));
        if (new Set(stableKeys).size !== stableKeys.length) throw new AppError(409, 'DUPLICATE_QUESTION_KEY', '稳定题目标识不能重复');
        await ProductQuestion.destroy({ where: { templateId: id }, transaction });
        for (const [index, question] of input.questions.entries()) {
          if (!QUESTION_TYPES.includes(question.questionType)) throw new AppError(400, 'VALIDATION_ERROR', '问题类型无效');
          await ProductQuestion.create({ templateId: id, stableKey: stableKeys[index], title: requiredText(question.title, '问题标题', 4000), description: question.description?.trim() || null, questionType: question.questionType, required: Boolean(question.required), options: Array.isArray(question.options) ? question.options : [], sortOrder: index }, { transaction });
        }
      }
      const status = input.status || template.status;
      await template.update({ ...(input.name ? { name: requiredText(input.name, '问卷名称', 200) } : {}), ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}), status, ...(status === 'active' && !template.publishedAt ? { publishedAt: new Date() } : {}) }, { transaction });
    });
    await this.log(user, 'product_questionnaire_template', id, input.status === 'retired' ? '停用问卷模板' : '更新问卷模板');
    return this.getTemplate(id);
  }

  async listRules() {
    return ProductTypeQuestionnaireRule.findAll({ include: [{ model: ProductType, as: 'productType' }, { model: ProductQuestionnaireTemplate, as: 'template' }], order: [['createdAt', 'DESC']] });
  }

  async saveRules(productTypeId: string, rules: Array<{ templateId: string; required?: boolean }>, user: RequestUser) {
    await this.activeType(productTypeId);
    const saved = await sequelize.transaction(async (transaction) => {
      await ProductTypeQuestionnaireRule.update({ active: false }, { where: { productTypeId }, transaction });
      const result = [];
      for (const input of rules || []) {
        const template = await ProductQuestionnaireTemplate.findOne({ where: { id: input.templateId, status: 'active' }, transaction });
        if (!template) throw new AppError(404, 'NOT_FOUND', '规则引用的问卷不存在或未启用');
        const [rule] = await ProductTypeQuestionnaireRule.findOrCreate({ where: { productTypeId, templateId: input.templateId }, defaults: { productTypeId, templateId: input.templateId, required: input.required !== false, active: true, createdBy: user.userId }, transaction });
        await rule.update({ required: input.required !== false, active: true }, { transaction });
        result.push(rule);
      }
      return result;
    });
    await this.log(user, 'product_type', productTypeId, '更新产品类型适用问卷规则');
    return saved;
  }
}

export default new ProductComplianceService();
