import { RiskRecord, RiskLevel, RemediationStatus, RiskStatus, OperationType, AuditLog } from '../models';
import { Op } from 'sequelize';

interface CreateRiskInput {
  assessmentType: string;
  assessmentTarget: string;
  riskIdentification: string;
  riskLevel: RiskLevel;
  remediationMeasures?: string;
  remediationStatus?: RemediationStatus;
  riskStatus?: RiskStatus;
}

class RiskService {
  async getRisks(query: {
    page?: number; pageSize?: number; riskLevel?: RiskLevel;
    remediationStatus?: RemediationStatus; riskStatus?: RiskStatus;
    assessmentType?: string;
  }) {
    const { page = 1, pageSize = 20, riskLevel, remediationStatus, riskStatus, assessmentType } = query;
    const where: any = {};
    if (riskLevel) where.riskLevel = riskLevel;
    if (remediationStatus) where.remediationStatus = remediationStatus;
    if (riskStatus) where.riskStatus = riskStatus;
    if (assessmentType) where.assessmentType = assessmentType;

    const { count, rows } = await RiskRecord.findAndCountAll({
      where,
      order: [['identifiedAt', 'ASC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return {
      items: rows.map(r => r.toJSON()),
      pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
    };
  }

  async createRisk(input: CreateRiskInput, userId: string) {
    const risk = await RiskRecord.create({
      assessmentType: input.assessmentType as any,
      assessmentTarget: input.assessmentTarget,
      riskIdentification: input.riskIdentification,
      riskLevel: input.riskLevel,
      remediationMeasures: input.remediationMeasures || null,
      remediationStatus: input.remediationStatus || RemediationStatus.NOT_REMEDIATED,
      riskStatus: input.riskStatus || RiskStatus.RISK_ACCEPTANCE,
    } as any);

    await AuditLog.create({
      userId, operationType: OperationType.CREATE, resourceType: 'risk',
      resourceId: risk.id, success: true,
      operationDetails: `创建风险记录: ${input.riskIdentification.substring(0, 50)}`,
    } as any);

    return risk;
  }

  async deleteRisk(id: string, userId: string) {
    const risk = await RiskRecord.findByPk(id);
    if (!risk) throw new Error('风险记录不存在');
    await risk.destroy();

    await AuditLog.create({
      userId, operationType: OperationType.DELETE, resourceType: 'risk',
      resourceId: id, success: true,
      operationDetails: '删除风险记录',
    } as any);
  }

  async updateRisk(id: string, data: { remediationStatus?: RemediationStatus; riskStatus?: RiskStatus; riskIdentification?: string; remediationMeasures?: string; riskLevel?: RiskLevel }, userId: string) {
    const risk = await RiskRecord.findByPk(id);
    if (!risk) throw new Error('风险记录不存在');
    if (data.riskIdentification !== undefined) risk.riskIdentification = data.riskIdentification;
    if (data.remediationMeasures !== undefined) risk.remediationMeasures = data.remediationMeasures;
    if (data.riskLevel !== undefined) risk.riskLevel = data.riskLevel;
    if (data.remediationStatus) risk.remediationStatus = data.remediationStatus;
    if (data.riskStatus) risk.riskStatus = data.riskStatus;
    risk.updatedAt = new Date();
    await risk.save();

    await AuditLog.create({
      userId, operationType: OperationType.UPDATE, resourceType: 'risk',
      resourceId: id, success: true,
      operationDetails: `更新风险状态: ${JSON.stringify(data)}`,
    } as any);

    return risk;
  }
}

export default new RiskService();
