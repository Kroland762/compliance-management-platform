import fs from 'fs';
import path from 'path';
import { Op } from 'sequelize';
import { QuestionItem, EvidenceFile, AuditTask, TaskStatus, AnswerStatus, AuditLog, OperationType, EvidenceType, EvidenceStatus, EvidenceScanStatus } from '../models';
import sequelize from '../config/database';
import { encrypt, decrypt } from '../utils/crypto';
import auditLogService from './audit-log.service';
import { inspectEvidenceFile, serializeEvidence } from './evidence-security.service';
import objectAccessService, { type AccessActor } from './object-access.service';

function inferMimeType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  const types: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
    '.csv': 'text/csv',
  };
  return types[extension] || 'application/octet-stream';
}

class QuestionnaireService {
  async getQuestions(taskId: string, actor?: string | AccessActor) {
    const where: any = { taskId };
    if (actor && typeof actor !== 'string') {
      const task = await objectAccessService.assertTaskAccess(taskId, actor, 'read');
      const includeAll = objectAccessService.hasTenantWideTaskScope(actor)
        || task.createdBy === actor.userId
        || task.reviewerId === actor.userId;
      if (!includeAll) where.assignedTo = actor.userId;
    } else if (actor) {
      const userId = actor;
      const { User } = await import('../models');
      const user = await User.findByPk(userId);
      if (user && user.role === 'user') {
        where.assignedTo = userId;
      }
    }
    const items = await QuestionItem.findAll({
      where,
      include: [{ association: 'evidenceFiles' }],
      order: [['sequenceNumber', 'ASC']],
    });
    // Decrypt sensitive fields
    return Promise.all(items.map(async item => {
      const json = item.toJSON() as any;
      const existingFiles = ((json.evidenceFiles || []) as any[])
        .filter(file => file.status === undefined || file.status === EvidenceStatus.ACTIVE);
      let historicalEvidence = existingFiles
        .filter(file => file.evidenceType === EvidenceType.HISTORICAL)
        .sort((a, b) => (b.version || 1) - (a.version || 1))[0] || null;
      if (!historicalEvidence && item.historicalEvidencePath) {
        historicalEvidence = (await this.ensureLegacyHistoricalEvidence(item))?.toJSON() || null;
      }
      json.historicalEvidence = historicalEvidence ? serializeEvidence(historicalEvidence) : null;
      json.evidenceFiles = existingFiles
        .filter(file => file.evidenceType !== EvidenceType.HISTORICAL)
        .map(file => serializeEvidence(file));
      if (json.currentStatusDescription) {
        json.currentStatusDescription = decrypt(json.currentStatusDescription);
      }
      return json;
    }));
  }

  async saveAnswer(itemId: string, currentStatusDescription: string) {
    const item = await QuestionItem.findByPk(itemId);
    if (!item) throw new Error('问卷条目不存在');
    item.currentStatusDescription = currentStatusDescription
      ? encrypt(currentStatusDescription)
      : '';
    item.answerStatus = currentStatusDescription ? AnswerStatus.ANSWERED : AnswerStatus.PENDING;
    item.answeredAt = new Date();
    await item.save();

    // 首次作答：任务从「已分配」→「进行中」
    if (currentStatusDescription) {
      const { AuditTask, TaskStatus } = await import('../models');
      const task = await AuditTask.findByPk(item.taskId);
      if (task && task.status === TaskStatus.ASSIGNED) {
        task.status = TaskStatus.IN_PROGRESS;
        await task.save();
      }
    }

    return item;
  }

  async validateCompletion(taskId: string, userId?: string): Promise<{ valid: boolean; pendingCount: number }> {
    const where: any = { taskId, answerStatus: AnswerStatus.PENDING };
    if (userId) where.assignedTo = userId;
    const pending = await QuestionItem.count({ where });
    return { valid: pending === 0, pendingCount: pending };
  }

  async submitTask(taskId: string, userId: string) {
    const validation = await this.validateCompletion(taskId, userId);
    if (!validation.valid) {
      throw new Error(`还有 ${validation.pendingCount} 个问题尚未填写`);
    }
    const task = await AuditTask.findByPk(taskId);
    if (!task) throw new Error('任务不存在');
    task.status = TaskStatus.SUBMITTED;
    task.submittedAt = new Date();
    await task.save();

    await AuditLog.create({
      userId, operationType: OperationType.UPDATE, resourceType: 'task',
      resourceId: taskId, success: true,
      operationDetails: '提交审计任务',
    } as any);

    return task;
  }

  async uploadEvidence(questionItemId: string, file: Express.Multer.File, uploadedBy: string) {
    const item = await QuestionItem.findByPk(questionItemId);
    if (!item) {
      await fs.promises.unlink(file.path).catch(() => {});
      throw new Error('问卷条目不存在');
    }
    if (file.size > 52428800) {
      await fs.promises.unlink(file.path).catch(() => {});
      throw new Error('文件大小不能超过50MB');
    }

    try {
      const inspection = await inspectEvidenceFile(file);
      const version = await this.nextEvidenceVersion(questionItemId, EvidenceType.CURRENT);
      const evidence = await EvidenceFile.create({
        questionItemId, uploadedBy,
        evidenceType: EvidenceType.CURRENT,
        version,
        originalFilename: inspection.originalFilename,
        storedFilename: file.filename,
        filePath: file.path,
        fileSize: file.size,
        mimeType: inspection.mimeType,
        sha256: inspection.sha256,
        scanStatus: inspection.scanStatus,
        status: EvidenceStatus.ACTIVE,
      } as any);
      await auditLogService.log({
        userId: uploadedBy, operationType: OperationType.CREATE, resourceType: 'evidence',
        resourceId: evidence.id, operationDetails: `上传证据 v${version}，SHA-256: ${inspection.sha256}`, success: true,
      });
      return serializeEvidence(evidence);
    } catch (error) {
      await fs.promises.unlink(file.path).catch(() => {});
      throw error;
    }
  }

  async deleteEvidence(evidenceId: string, deletedBy: string) {
    const evidence = await EvidenceFile.findByPk(evidenceId);
    if (!evidence) throw new Error('证据文件不存在');
    if (evidence.isLocked) throw new Error('证据已锁定，不能删除');
    if (evidence.status === EvidenceStatus.DELETED) return;
    await evidence.update({ status: EvidenceStatus.DELETED, deletedAt: new Date(), deletedBy });
    await auditLogService.log({
      userId: deletedBy, operationType: OperationType.DELETE, resourceType: 'evidence',
      resourceId: evidence.id, operationDetails: `软删除证据 v${evidence.version}，文件保留用于审计追溯`, success: true,
    });
  }

  async getHistoricalEvidence(questionItemId: string) {
    const item = await QuestionItem.findByPk(questionItemId);
    if (!item) return [];
    const evidence = await this.ensureLegacyHistoricalEvidence(item);
    return evidence ? [serializeEvidence(evidence)] : [];
  }

  async uploadHistoricalEvidence(questionItemId: string, file: Express.Multer.File, uploadedBy: string) {
    const item = await QuestionItem.findByPk(questionItemId);
    if (!item) {
      fs.unlink(file.path, () => {});
      throw new Error('问卷条目不存在');
    }
    if (file.size > 52428800) {
      fs.unlink(file.path, () => {});
      throw new Error('文件大小不能超过50MB');
    }

    const oldEvidence = await EvidenceFile.findOne({
      where: { questionItemId, evidenceType: EvidenceType.HISTORICAL, status: EvidenceStatus.ACTIVE },
      order: [['version', 'DESC']],
    });
    const transaction = await sequelize.transaction();
    try {
      const inspection = await inspectEvidenceFile(file);
      const version = await this.nextEvidenceVersion(questionItemId, EvidenceType.HISTORICAL);
      if (oldEvidence) {
        await oldEvidence.update({ status: EvidenceStatus.DELETED, deletedAt: new Date(), deletedBy: uploadedBy }, { transaction });
      }
      const evidence = await EvidenceFile.create({
        questionItemId,
        uploadedBy,
        evidenceType: EvidenceType.HISTORICAL,
        version,
        supersedesId: oldEvidence?.id || null,
        originalFilename: inspection.originalFilename,
        storedFilename: file.filename,
        filePath: file.path,
        fileSize: file.size,
        mimeType: inspection.mimeType,
        sha256: inspection.sha256,
        scanStatus: inspection.scanStatus,
        status: EvidenceStatus.ACTIVE,
      } as any, { transaction });
      item.historicalEvidencePath = file.path;
      await item.save({ transaction });
      await transaction.commit();
      await auditLogService.log({
        userId: uploadedBy, operationType: OperationType.CREATE, resourceType: 'historical_evidence',
        resourceId: evidence.id, operationDetails: `上传历史证据 v${version}，SHA-256: ${inspection.sha256}`, success: true,
      });
      return serializeEvidence(evidence);
    } catch (error) {
      await transaction.rollback();
      fs.unlink(file.path, () => {});
      throw error;
    }
  }

  async deleteHistoricalEvidence(questionItemId: string, deletedBy: string) {
    const item = await QuestionItem.findByPk(questionItemId);
    if (!item) throw new Error('问卷条目不存在');
    const evidence = await EvidenceFile.findOne({
      where: { questionItemId, evidenceType: EvidenceType.HISTORICAL, status: EvidenceStatus.ACTIVE },
      order: [['version', 'DESC']],
    });
    const transaction = await sequelize.transaction();
    try {
      if (evidence?.isLocked) throw new Error('证据已锁定，不能删除');
      if (evidence) {
        await evidence.update({ status: EvidenceStatus.DELETED, deletedAt: new Date(), deletedBy }, { transaction });
      }
      item.historicalEvidencePath = null;
      await item.save({ transaction });
      await transaction.commit();
      if (evidence) {
        await auditLogService.log({
          userId: deletedBy, operationType: OperationType.DELETE, resourceType: 'historical_evidence',
          resourceId: evidence.id, operationDetails: `软删除历史证据 v${evidence.version}`, success: true,
        });
      }
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async migrateLegacyHistoricalEvidence(): Promise<{ migrated: number; skipped: number; failed: number }> {
    const items = await QuestionItem.findAll({
      where: { historicalEvidencePath: { [Op.ne]: null } },
    });
    const result = { migrated: 0, skipped: 0, failed: 0 };
    for (const item of items) {
      const existed = await EvidenceFile.findOne({
        where: { questionItemId: item.id, evidenceType: EvidenceType.HISTORICAL, status: EvidenceStatus.ACTIVE },
      });
      if (existed) {
        result.skipped += 1;
        continue;
      }
      try {
        const migrated = await this.ensureLegacyHistoricalEvidence(item);
        if (migrated) result.migrated += 1;
        else result.failed += 1;
      } catch {
        result.failed += 1;
      }
    }
    return result;
  }

  async migrateEvidenceIntegrity(): Promise<{ updated: number; quarantined: number; missing: number }> {
    const rows = await EvidenceFile.findAll({
      where: {
        [Op.or]: [
          { sha256: null },
          { scanStatus: EvidenceScanStatus.PENDING },
        ],
      },
      order: [['questionItemId', 'ASC'], ['uploadedAt', 'ASC']],
    });
    const result = { updated: 0, quarantined: 0, missing: 0 };
    const versions = new Map<string, number>();

    for (const evidence of rows) {
      const key = `${evidence.questionItemId}:${evidence.evidenceType}`;
      const version = (versions.get(key) || 0) + 1;
      versions.set(key, version);
      if (!fs.existsSync(evidence.filePath)) {
        await evidence.update({ version, scanStatus: EvidenceScanStatus.ERROR, status: EvidenceStatus.QUARANTINED });
        result.missing += 1;
        continue;
      }
      try {
        const stat = await fs.promises.stat(evidence.filePath);
        const inspection = await inspectEvidenceFile({
          path: evidence.filePath,
          originalname: evidence.originalFilename,
          mimetype: evidence.mimeType,
          size: stat.size,
        } as Express.Multer.File);
        await evidence.update({
          version,
          originalFilename: inspection.originalFilename,
          sha256: inspection.sha256,
          mimeType: inspection.mimeType,
          scanStatus: EvidenceScanStatus.CLEAN,
        });
        result.updated += 1;
      } catch {
        await evidence.update({ version, scanStatus: EvidenceScanStatus.REJECTED, status: EvidenceStatus.QUARANTINED });
        result.quarantined += 1;
      }
    }
    return result;
  }

  private async ensureLegacyHistoricalEvidence(item: QuestionItem): Promise<EvidenceFile | null> {
    const existing = await EvidenceFile.findOne({
      where: { questionItemId: item.id, evidenceType: EvidenceType.HISTORICAL, status: EvidenceStatus.ACTIVE },
      order: [['version', 'DESC']],
    });
    if (existing || !item.historicalEvidencePath) return existing;

    const task = await AuditTask.findByPk(item.taskId, { attributes: ['createdBy'] });
    if (!task) return null;
    const filePath = item.historicalEvidencePath;
    const filename = path.basename(filePath);
    let fileSize = 0;
    try {
      fileSize = fs.statSync(path.resolve(filePath)).size;
    } catch {
      // 保留缺失文件的元数据，接口会返回明确的文件不存在提示。
    }

    try {
      return await EvidenceFile.create({
        questionItemId: item.id,
        evidenceType: EvidenceType.HISTORICAL,
        originalFilename: filename,
        storedFilename: filename,
        filePath,
        fileSize,
        mimeType: inferMimeType(filename),
        version: 1,
        scanStatus: EvidenceScanStatus.CLEAN,
        status: EvidenceStatus.ACTIVE,
        uploadedBy: task.createdBy,
      } as any);
    } catch (error: any) {
      if (error?.name === 'SequelizeUniqueConstraintError') {
        return EvidenceFile.findOne({
          where: { questionItemId: item.id, evidenceType: EvidenceType.HISTORICAL, status: EvidenceStatus.ACTIVE },
        });
      }
      throw error;
    }
  }

  private async nextEvidenceVersion(questionItemId: string, evidenceType: EvidenceType): Promise<number> {
    const current = await EvidenceFile.max('version', { where: { questionItemId, evidenceType } });
    return Number(current || 0) + 1;
  }
}

export default new QuestionnaireService();
