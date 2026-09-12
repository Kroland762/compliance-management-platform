import { Op } from 'sequelize';
import Papa from 'papaparse';
import sequelize from '../config/database';
import {
  QuestionnaireTemplate,
  QuestionTemplate,
  AuditTask,
  TaskStatus,
  OperationType,
} from '../models';
import auditLogService from './audit-log.service';
import { parsePagination, pagination } from '../utils/pagination';
import { AppError } from '../utils/http';
import {
  LOCKED_VISIBLE_EVALUATION_COLUMN_KEYS,
  normalizeEvaluationColumnSchema,
  SYSTEM_EVALUATION_COLUMNS,
  type EvaluationColumnDefinition,
} from '../utils/evaluation-columns';

// CSV 必填字段
const REQUIRED_FIELDS = ['序号', '控制域名', '控制点'] as const;

const FIELD_MAP: Record<string, string> = {
  '序号': 'sequenceNumber', '控制域名': 'controlDomain', '控制点': 'controlPoint',
  '参考回答': 'referenceAnswer', '历史证据': 'historicalEvidencePath',
  '责任部门': 'responsibleDepartment', '责任人': 'responsiblePerson',
};

const CORE_LABELS: Record<string, string> = {
  sequenceNumber: '序号', controlDomain: '控制域名', controlPoint: '控制点',
  referenceAnswer: '参考回答', historicalEvidencePath: '历史证据',
  responsibleDepartment: '责任部门', responsiblePerson: '责任人',
};

function schemaFromHeaders(headers: string[]): EvaluationColumnDefinition[] {
  return headers.filter((header) => FIELD_MAP[header] !== 'referenceAnswer').map((header) => {
    const mapped = FIELD_MAP[header];
    return {
      key: mapped || `extraData.${header}`,
      label: mapped ? CORE_LABELS[mapped] : header,
      source: mapped ? 'core' : 'extra',
      visible: !['historicalEvidencePath', 'responsibleDepartment', 'responsiblePerson'].includes(mapped),
      width: mapped === 'controlPoint' ? 320 : mapped === 'referenceAnswer' ? 240 : 160,
    };
  });
}

function parseCsv(fileBuffer: Buffer) {
  const csvText = fileBuffer.toString('utf-8').replace(/^\uFEFF/, '');
  const result: any = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  if (result.errors?.length) {
    throw new AppError(400, 'IMPORT_FAILED', `CSV 解析失败: ${result.errors.map((e: any) => `第${e.row}行: ${e.message}`).join('; ')}`);
  }
  const headers: string[] = result.meta?.fields || [];
  for (const field of REQUIRED_FIELDS) {
    if (!headers.includes(field)) throw new AppError(400, 'IMPORT_FAILED', `CSV 缺少必填列: ${field}`);
  }
  if (!result.data.length) throw new AppError(400, 'IMPORT_FAILED', 'CSV 文件中没有数据行');
  return { headers, rows: result.data as Record<string, string>[] };
}

class TemplateService {
  /**
   * 通过 CSV 导入模板（包含题目）
   */
  async importTemplate(
    name: string,
    description: string | null,
    fileBuffer: Buffer,
    createdBy: string,
    options: {
      standardSeriesKey?: string;
      version?: string;
      controlKeyField?: string;
      columnSchema?: EvaluationColumnDefinition[];
    } = {},
  ): Promise<{ template: QuestionnaireTemplate; extraNote: string }> {
    const { headers, rows } = parseCsv(fileBuffer);
    const columnSchema = normalizeEvaluationColumnSchema(
      options.columnSchema?.length ? options.columnSchema : schemaFromHeaders(headers),
    );
    const controlKeyField = options.controlKeyField || '序号';
    if (!headers.includes(controlKeyField)) throw new AppError(400, 'IMPORT_FAILED', '稳定控制项标识列不在 CSV 中');

    // 动态映射：CSV 有什么列就导入什么列，不认识的存 extraData
    const mappedHeaders = headers.filter(h => FIELD_MAP[h]);
    const unmappedHeaders = headers.filter(h => !FIELD_MAP[h]);

    const questions = rows.map((row: any, index: number) => {
      const item: any = { controlKey: String(row[controlKeyField] || '').trim() };
      // 已知字段
      for (const h of mappedHeaders) item[FIELD_MAP[h]] = row[h] || null;
      // 未知字段 → extraData
      if (unmappedHeaders.length > 0) {
        const extra: any = {};
        for (const h of unmappedHeaders) extra[h] = row[h] || null;
        item.extraData = extra;
      }
      if (!item.sequenceNumber) item.sequenceNumber = String(index + 1);
      if (!item.controlKey) item.controlKey = item.sequenceNumber;
      return item;
    });
    if (new Set(questions.map((item: any) => item.controlKey)).size !== questions.length) {
      throw new AppError(409, 'DUPLICATE_CONTROL_KEY', '稳定控制项标识列存在重复值');
    }

    // 记录跳过的列名，在返回消息中提示
    let extraNote = '';
    if (unmappedHeaders.length > 0) {
      extraNote = `（含未识别列: ${unmappedHeaders.join(', ')}，已存入扩展数据）`;
    }

    const template = await sequelize.transaction(async (transaction) => {
      const created = await QuestionnaireTemplate.create({
        name,
        description: description || null,
        createdBy,
        questionCount: rows.length,
        standardSeriesKey: options.standardSeriesKey?.trim() || `standard-${Date.now()}`,
        version: options.version?.trim() || '1.0',
        columnSchema,
      } as any, { transaction });
      await QuestionTemplate.bulkCreate(questions.map((question) => ({ ...question, templateId: created.id })) as any, { transaction });
      return created;
    });

    await auditLogService.log({
      userId: createdBy,
      operationType: OperationType.CREATE,
      resourceType: 'template',
      resourceId: template.id,
      operationDetails: `导入模板"${name}"，包含 ${questions.length} 道题目`,
      success: true,
    });

    return { template, extraNote };
  }

  previewImport(fileBuffer: Buffer) {
    const { headers, rows } = parseCsv(fileBuffer);
    return {
      headers,
      rowCount: rows.length,
      sampleRows: rows.slice(0, 5),
      suggestedControlKeyField: '序号',
      columnSchema: schemaFromHeaders(headers),
    };
  }

  async updateColumns(id: string, columns: EvaluationColumnDefinition[], updatedBy: string) {
    const template = await QuestionnaireTemplate.findByPk(id);
    if (!template) throw new AppError(404, 'NOT_FOUND', '模板不存在');
    if (!Array.isArray(columns) || !columns.length) throw new AppError(400, 'VALIDATION_ERROR', '至少保留一个模板列');
    const allowed = new Set([
      ...(template.columnSchema || []).filter((column: any) => column.source !== 'system' && column.key !== 'referenceAnswer').map((column: any) => column.key),
      ...SYSTEM_EVALUATION_COLUMNS.map((column) => column.key),
    ]);
    const templateKeys = (template.columnSchema || [])
      .filter((column: any) => column.source !== 'system' && column.key !== 'referenceAnswer')
      .map((column: any) => column.key);
    if (new Set(columns.map((column) => column.key)).size !== columns.length
      || columns.some((column) => !allowed.has(column.key))
      || templateKeys.some((key) => !columns.some((column) => column.key === key))) {
      throw new AppError(400, 'VALIDATION_ERROR', '模板列配置包含重复、未知或缺失字段');
    }
    if ([...LOCKED_VISIBLE_EVALUATION_COLUMN_KEYS]
      .some((key) => !columns.some((column) => column.key === key && column.visible !== false))) {
      throw new AppError(400, 'VALIDATION_ERROR', '序号、评估点和工作流列属于必需列，不能隐藏');
    }
    const columnSchema = normalizeEvaluationColumnSchema(columns);
    await template.update({ columnSchema });
    await auditLogService.log({
      userId: updatedBy,
      operationType: OperationType.UPDATE,
      resourceType: 'template',
      resourceId: id,
      operationDetails: '更新评估表显示列及顺序',
      success: true,
    });
    return columnSchema;
  }

  /**
   * 获取模板列表
   */
  async getTemplates(query: {
    page?: number;
    pageSize?: number;
    keyword?: string;
  }) {
    const { page, pageSize } = parsePagination(query);
    const { keyword } = query;
    const where: any = {};
    if (keyword) {
      where.name = { [Op.iLike]: `%${keyword}%` };
    }

    const { count, rows } = await QuestionnaireTemplate.findAndCountAll({
      where,
      include: [
        { association: 'templateQuestions', attributes: ['id'], separate: true },
      ],
      order: [['createdAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      distinct: true,
    });

    return {
      items: rows.map(t => ({
        ...t.toJSON(),
        questionCount: (t as any).templateQuestions?.length ?? t.questionCount,
      })),
      pagination: pagination(page, pageSize, count),
    };
  }

  /**
   * 获取模板详情（含题目列表）
   */
  async getTemplateById(id: string) {
    const template = await QuestionnaireTemplate.findByPk(id, {
      include: [
        {
          association: 'templateQuestions',
          order: [['sequenceNumber', 'ASC']],
        },
      ],
    });

    if (!template) {
      throw new Error('模板不存在');
    }

    return template;
  }

  /**
   * 删除模板（检查是否被活跃任务使用）
   */
  async deleteTemplate(id: string, deletedBy: string) {
    const template = await QuestionnaireTemplate.findByPk(id);
    if (!template) {
      throw new Error('模板不存在');
    }

    // 检查是否有活跃任务引用此模板
    const activeTaskCount = await AuditTask.count({
      where: {
        templateId: id,
        status: {
          [Op.in]: [
            TaskStatus.PREPARING,
            TaskStatus.READY,
            TaskStatus.IN_PROGRESS,
            TaskStatus.PENDING_REVIEW,
            TaskStatus.PENDING_CLOSURE,
          ],
        },
      },
    });

    if (activeTaskCount > 0) {
      throw new Error('该模板正被活跃任务使用，无法删除');
    }

    // 删除关联的题目
    await QuestionTemplate.destroy({ where: { templateId: id } });

    // 删除模板
    await template.destroy();

    await auditLogService.log({
      userId: deletedBy,
      operationType: OperationType.DELETE,
      resourceType: 'template',
      resourceId: id,
      operationDetails: `删除模板"${template.name}"`,
      success: true,
    });
  }

  /**
   * 查看模板关联的任务
   */
  async getTemplateTasks(templateId: string) {
    return AuditTask.findAll({
      where: { templateId },
      include: [
        { association: 'creator', attributes: ['id', 'username'] },
        { association: 'assignee', attributes: ['id', 'username'] },
      ],
      order: [['createdAt', 'DESC']],
    });
  }
}

export default new TemplateService();
