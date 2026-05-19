import ExcelJS from 'exceljs';
import { AuditTask, QuestionItem, RiskRecord } from '../models';

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
      order: [['sequenceNumber', 'ASC']],
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('审计报告');

    sheet.columns = [
      { header: '序号', key: 'seq', width: 8 },
      { header: '控制域名', key: 'domain', width: 20 },
      { header: '控制点', key: 'point', width: 30 },
      { header: '参考回答', key: 'reference', width: 30 },
      { header: '现状说明', key: 'status', width: 30 },
      { header: '符合性', key: 'compliance', width: 15 },
      { header: '风险识别', key: 'risk', width: 20 },
      { header: '风险级别', key: 'level', width: 12 },
      { header: '补救措施', key: 'remediation', width: 30 },
    ];

    for (const item of items) {
      sheet.addRow({
        seq: item.sequenceNumber,
        domain: item.controlDomain,
        point: item.controlPoint,
        reference: item.referenceAnswer,
        status: item.currentStatusDescription,
        compliance: item.complianceStatus,
        risk: item.riskIdentification,
        level: item.riskLevel,
        remediation: item.remediationMeasures,
      });
    }

    sheet.addRow({});
    sheet.addRow({ seq: '导出时间', domain: new Date().toISOString() });
    sheet.addRow({ seq: '导出人', domain: exportedBy });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async exportRisks(filters: any): Promise<Buffer> {
    const risks = await RiskRecord.findAll({
      where: filters,
      order: [['riskLevel', 'ASC']],
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('风险汇总');

    sheet.columns = [
      { header: '序号', key: 'seq', width: 8 },
      { header: '评估方式', key: 'type', width: 18 },
      { header: '评估对象', key: 'target', width: 25 },
      { header: '风险识别', key: 'risk', width: 30 },
      { header: '风险级别', key: 'level', width: 12 },
      { header: '补救措施', key: 'remediation', width: 30 },
      { header: '补救状态', key: 'remStatus', width: 15 },
      { header: '风险状态', key: 'riskStatus', width: 15 },
    ];

    risks.forEach((r, i) => {
      sheet.addRow({
        seq: i + 1,
        type: r.assessmentType,
        target: r.assessmentTarget,
        risk: r.riskIdentification,
        level: r.riskLevel,
        remediation: r.remediationMeasures,
        remStatus: r.remediationStatus,
        riskStatus: r.riskStatus,
      });
    });

    sheet.addRow({});
    sheet.addRow({ seq: '导出时间', type: new Date().toISOString() });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}

export default new ExportService();
