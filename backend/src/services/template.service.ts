import { Readable } from 'stream';
import { Op } from 'sequelize';
import Papa from 'papaparse';
import {
  QuestionnaireTemplate,
  QuestionTemplate,
  AuditTask,
  TaskStatus,
  OperationType,
} from '../models';
import auditLogService from './audit-log.service';
import { parsePagination, pagination } from '../utils/pagination';

// CSV 行数据结构
interface CsvRow {
  '序号': string;
  '控制域名': string;
  '控制点': string;
  '参考回答': string;
  '历史证据': string;
  '责任部门': string;
  '责任人': string;
}

// CSV 必填字段
const REQUIRED_FIELDS = ['序号', '控制域名', '控制点'] as const;

class TemplateService {
  /**
   * 通过 CSV 导入模板（包含题目）
   */
  async importTemplate(
    name: string,
    description: string | null,
    fileBuffer: Buffer,
    createdBy: string,
  ): Promise<{ template: QuestionnaireTemplate; extraNote: string }> {
    // 解析 CSV
    const csvText = fileBuffer.toString('utf-8');
    const parseResult: any = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    if (parseResult.errors && parseResult.errors.length > 0) {
      const errMsg = parseResult.errors.map((e: any) => `第${e.row}行: ${e.message}`).join('; ');
      throw new Error(`CSV 解析失败: ${errMsg}`);
    }

    // 校验必填字段
    const headers: string[] = parseResult.meta?.fields || [];
    for (const field of REQUIRED_FIELDS) {
      if (!headers.includes(field)) {
        throw new Error(`CSV 缺少必填列: ${field}`);
      }
    }

    if (parseResult.data.length === 0) {
      throw new Error('CSV 文件中没有数据行');
    }

    // 创建模板
    const template = await QuestionnaireTemplate.create({
      name,
      description: description || null,
      createdBy,
      questionCount: parseResult.data.length,
    } as any);

    // 动态映射：CSV 有什么列就导入什么列，不认识的存 extraData
    const fieldMap: Record<string, string> = {
      '序号': 'sequenceNumber', '控制域名': 'controlDomain', '控制点': 'controlPoint',
      '参考回答': 'referenceAnswer', '历史证据': 'historicalEvidencePath',
      '责任部门': 'responsibleDepartment', '责任人': 'responsiblePerson',
    };
    const mappedHeaders = headers.filter(h => fieldMap[h]);
    const unmappedHeaders = headers.filter(h => !fieldMap[h]);

    const questions = parseResult.data.map((row: any, index: number) => {
      const item: any = { templateId: template.id };
      // 已知字段
      for (const h of mappedHeaders) item[fieldMap[h]] = row[h] || null;
      // 未知字段 → extraData
      if (unmappedHeaders.length > 0) {
        const extra: any = {};
        for (const h of unmappedHeaders) extra[h] = row[h] || null;
        item.extraData = extra;
      }
      if (!item.sequenceNumber) item.sequenceNumber = String(index + 1);
      return item;
    });

    // 记录跳过的列名，在返回消息中提示
    let extraNote = '';
    if (unmappedHeaders.length > 0) {
      extraNote = `（含未识别列: ${unmappedHeaders.join(', ')}，已存入扩展数据）`;
    }

    await QuestionTemplate.bulkCreate(questions as any);

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
            TaskStatus.DRAFT,
            TaskStatus.ASSIGNED,
            TaskStatus.IN_PROGRESS,
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
