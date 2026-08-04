import ExcelJS from 'exceljs';
import { Op, type WhereOptions } from 'sequelize';
import {
  Asset,
  AuditTask,
  EvidenceFile,
  QuestionItem,
  RemediationAction,
  RiskActionLink,
  RiskAffectedAsset,
  RiskRecord,
  RiskSource,
} from '../models';
import { decrypt } from '../utils/crypto';

function style(sheet: ExcelJS.Worksheet): void {
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: sheet.getRow(1).getCell(sheet.columnCount).address };
}

class ExportService {
  async exportAuditTask(taskId: string, exportedBy: string): Promise<Buffer> {
    const task = await AuditTask.findByPk(taskId, {
      include: [
        { association: 'creator', attributes: ['username'] },
        { association: 'assignee', attributes: ['username'] },
      ],
    });
    if (!task) throw new Error('任务不存在');
    const items = await QuestionItem.findAll({
      where: { taskId },
      include: [{ association: 'asset', attributes: ['code', 'name'] }],
      order: [['sequenceNumber', 'ASC'], ['assetId', 'ASC']],
    });
    const workbook = new ExcelJS.Workbook();
    workbook.creator = exportedBy;
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('评估单元');
    sheet.columns = [
      { header: '评估名称', key: 'task', width: 24 },
      { header: '控制项编号', key: 'seq', width: 14 },
      { header: '控制域', key: 'domain', width: 20 },
      { header: '控制项', key: 'point', width: 42 },
      { header: '资产编码', key: 'assetCode', width: 20 },
      { header: '资产名称', key: 'assetName', width: 24 },
      { header: '现状说明', key: 'answer', width: 42 },
      { header: '符合性', key: 'compliance', width: 18 },
      { header: '流程状态', key: 'workflow', width: 18 },
      { header: '自审', key: 'selfReview', width: 10 },
    ];
    for (const item of items) {
      const value: any = item.toJSON();
      sheet.addRow({
        task: task.name || task.assessmentTarget,
        seq: item.sequenceNumber,
        domain: item.controlDomain,
        point: item.controlPoint,
        assetCode: value.asset?.code,
        assetName: value.asset?.name,
        answer: item.currentStatusDescription ? decrypt(item.currentStatusDescription) : '',
        compliance: item.complianceStatus,
        workflow: item.workflowStatus,
        selfReview: item.reviewedBy && item.reviewedBy === item.assignedTo ? '是' : '否',
      });
    }
    style(sheet);
    const metadata = workbook.addWorksheet('导出信息');
    metadata.addRows([
      ['评估名称', task.name || task.assessmentTarget],
      ['导出时间', new Date().toISOString()],
      ['导出人', exportedBy],
    ]);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async exportRisks(
    filters: Record<string, unknown>,
    riskAccessWhere: WhereOptions,
    metadata: { tenantName: string; exportedBy: string },
  ): Promise<Buffer> {
    const where: any = { ...(riskAccessWhere as object) };
    if (filters.status) where.status = filters.status;
    if (filters.riskLevel) where.riskLevel = filters.riskLevel;
    if (filters.treatmentStrategy) where.treatmentStrategy = filters.treatmentStrategy;
    if (filters.ownerDepartmentId) where.ownerDepartmentId = filters.ownerDepartmentId;
    if (filters.keyword) {
      where[Op.or] = [
        { code: { [Op.iLike]: `%${filters.keyword}%` } },
        { title: { [Op.iLike]: `%${filters.keyword}%` } },
      ];
    }
    const risks = await RiskRecord.findAll({ where, order: [['identifiedAt', 'DESC']] });
    const riskIds = risks.map((risk) => risk.id);
    const taskIds = [...new Set(risks.map((risk) => risk.taskId))];
    const tasks = taskIds.length
      ? await AuditTask.findAll({
        where: { id: { [Op.in]: taskIds } },
        include: [{ association: 'template', attributes: ['name'] }],
      })
      : [];
    const [sources, impacts, links] = riskIds.length ? await Promise.all([
      RiskSource.findAll({
        where: { riskId: { [Op.in]: riskIds } },
        include: [{ association: 'controlEvaluation' }],
      }),
      RiskAffectedAsset.findAll({
        where: { riskId: { [Op.in]: riskIds } },
        include: [{ association: 'asset' }],
      }),
      RiskActionLink.findAll({
        where: { riskId: { [Op.in]: riskIds } },
        include: [{ association: 'action' }],
      }),
    ]) : [[], [], []];
    const actionIds = [...new Set((links as RiskActionLink[]).map((link) => link.actionId))];
    const actions = actionIds.length
      ? await RemediationAction.findAll({ where: { id: { [Op.in]: actionIds } } })
      : [];
    const actionById = new Map(actions.map((action) => [action.id, action]));
    const evidence = await EvidenceFile.findAll({
      where: {
        status: 'active',
        [Op.or]: [
          { questionItemId: { [Op.in]: (sources as RiskSource[]).map((source) => source.controlEvaluationId) } },
          { remediationActionId: { [Op.in]: actionIds } },
        ],
      },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = metadata.exportedBy;
    workbook.created = new Date();
    const metadataSheet = workbook.addWorksheet('报告信息');
    metadataSheet.addRows([
      ['租户', metadata.tenantName],
      ['导出时间', new Date().toISOString()],
      ['导出人', metadata.exportedBy],
      ['风险数量', risks.length],
      ['涉及标准', [...new Set(tasks.map((task: any) => task.template?.name).filter(Boolean))].join('、') || '—'],
      ['评估周期', tasks.map((task) =>
        `${task.name || task.assessmentTarget}: ${task.periodStart || '—'} 至 ${task.periodEnd || '—'}`).join('\n') || '—'],
      ['包含单人自审', (links as RiskActionLink[]).some((link) => link.selfReview) ? '是' : '否'],
    ]);
    metadataSheet.getColumn(1).width = 20;
    metadataSheet.getColumn(2).width = 80;
    const riskSheet = workbook.addWorksheet('风险');
    riskSheet.columns = [
      { header: '风险编号', key: 'code', width: 22 },
      { header: '标题', key: 'title', width: 30 },
      { header: '描述', key: 'description', width: 42 },
      { header: '等级', key: 'riskLevel', width: 12 },
      { header: '处置策略', key: 'strategy', width: 16 },
      { header: '状态', key: 'status', width: 22 },
      { header: '责任部门', key: 'department', width: 38 },
      { header: '负责人', key: 'owner', width: 38 },
      { header: '期限', key: 'dueDate', width: 16 },
      { header: '确认时间', key: 'confirmedAt', width: 24 },
      { header: '关闭时间', key: 'closedAt', width: 24 },
    ];
    risks.forEach((risk) => riskSheet.addRow({
      code: risk.code,
      title: risk.title,
      description: risk.description,
      riskLevel: risk.riskLevel,
      strategy: risk.treatmentStrategy,
      status: risk.status,
      department: risk.ownerDepartmentId,
      owner: risk.ownerUserId,
      dueDate: risk.dueDate,
      confirmedAt: risk.confirmedAt,
      closedAt: risk.closedAt,
    }));

    const sourceSheet = workbook.addWorksheet('来源');
    sourceSheet.columns = [
      { header: '风险编号', key: 'riskCode', width: 22 },
      { header: '评估单元ID', key: 'evaluationId', width: 38 },
      { header: '控制项编号', key: 'sequenceNumber', width: 16 },
      { header: '控制项', key: 'controlPoint', width: 42 },
      { header: '关系类型', key: 'relationType', width: 16 },
      { header: '说明', key: 'rationale', width: 34 },
    ];
    (sources as any[]).forEach((source) => sourceSheet.addRow({
      riskCode: risks.find((risk) => risk.id === source.riskId)?.code,
      evaluationId: source.controlEvaluationId,
      sequenceNumber: source.controlEvaluation?.sequenceNumber,
      controlPoint: source.controlEvaluation?.controlPoint,
      relationType: source.relationType,
      rationale: source.rationale,
    }));

    const assetSheet = workbook.addWorksheet('受影响资产');
    assetSheet.columns = [
      { header: '风险编号', key: 'riskCode', width: 22 },
      { header: '资产编码', key: 'assetCode', width: 20 },
      { header: '资产名称', key: 'assetName', width: 26 },
      { header: '影响等级', key: 'impactLevel', width: 16 },
      { header: '影响说明', key: 'description', width: 42 },
    ];
    (impacts as any[]).forEach((impact) => assetSheet.addRow({
      riskCode: risks.find((risk) => risk.id === impact.riskId)?.code,
      assetCode: impact.asset?.code,
      assetName: impact.asset?.name,
      impactLevel: impact.impactLevel,
      description: impact.impactDescription,
    }));

    const actionSheet = workbook.addWorksheet('整改行动');
    actionSheet.columns = [
      { header: '行动编号', key: 'code', width: 22 },
      { header: '标题', key: 'title', width: 30 },
      { header: '描述', key: 'description', width: 42 },
      { header: '负责人', key: 'owner', width: 38 },
      { header: '责任部门', key: 'department', width: 38 },
      { header: '期限', key: 'dueDate', width: 16 },
      { header: '状态', key: 'status', width: 22 },
    ];
    actions.forEach((action) => actionSheet.addRow({
      code: action.code,
      title: action.title,
      description: action.description,
      owner: action.ownerUserId,
      department: action.ownerDepartmentId,
      dueDate: action.dueDate,
      status: action.status,
    }));

    const verificationSheet = workbook.addWorksheet('逐风险复核');
    verificationSheet.columns = [
      { header: '风险编号', key: 'riskCode', width: 22 },
      { header: '行动编号', key: 'actionCode', width: 22 },
      { header: '是否必要', key: 'required', width: 12 },
      { header: '复核结论', key: 'status', width: 18 },
      { header: '复核意见', key: 'comment', width: 42 },
      { header: '自审', key: 'selfReview', width: 10 },
      { header: '复核时间', key: 'verifiedAt', width: 24 },
    ];
    (links as RiskActionLink[]).forEach((link) => verificationSheet.addRow({
      riskCode: risks.find((risk) => risk.id === link.riskId)?.code,
      actionCode: actionById.get(link.actionId)?.code,
      required: link.isRequired ? '是' : '否',
      status: link.verificationStatus,
      comment: link.reviewComment,
      selfReview: link.selfReview ? '是' : '否',
      verifiedAt: link.verifiedAt,
    }));

    const evidenceSheet = workbook.addWorksheet('证据索引');
    evidenceSheet.columns = [
      { header: '证据ID', key: 'id', width: 38 },
      { header: '父对象类型', key: 'parentType', width: 18 },
      { header: '父对象ID', key: 'parentId', width: 38 },
      { header: '原始文件名', key: 'filename', width: 36 },
      { header: 'MIME', key: 'mime', width: 24 },
      { header: 'SHA-256', key: 'sha', width: 66 },
      { header: '用途', key: 'purpose', width: 18 },
      { header: '上传时间', key: 'uploadedAt', width: 24 },
    ];
    evidence.forEach((file) => evidenceSheet.addRow({
      id: file.id,
      parentType: file.questionItemId ? '评估单元' : '整改行动',
      parentId: file.questionItemId || file.remediationActionId,
      filename: file.originalFilename,
      mime: file.mimeType,
      sha: file.sha256,
      purpose: file.evidencePurpose || file.evidenceType,
      uploadedAt: file.uploadedAt,
    }));
    [riskSheet, sourceSheet, assetSheet, actionSheet, verificationSheet, evidenceSheet].forEach(style);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}

export default new ExportService();
