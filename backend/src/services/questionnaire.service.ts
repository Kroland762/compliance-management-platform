import fs from 'fs';
import path from 'path';
import { Op } from 'sequelize';
import sequelize from '../config/database';
import {
  QuestionItem,
  EvidenceFile,
  AuditTask,
  TaskStatus,
  AnswerStatus,
  OperationType,
  EvidenceType,
  EvidenceStatus,
  EvidenceScanStatus,
} from '../models';
import { encrypt, decrypt } from '../utils/crypto';
import type { PermissionMatrix } from '../models/Role';
import { inspectEvidenceFile, serializeEvidence, validateEvidence } from './evidence-security.service';
import { fileStorage } from './file-storage.service';
import { AppError } from '../utils/http';
import auditLogService from './audit-log.service';

class QuestionnaireService {
  async getQuestions(taskId: string, user?: { userId: string; permissions: PermissionMatrix }) {
    const where: any = { taskId };
    const canReadAll = user?.permissions?.tasks?.some((action) => ['create', 'update', 'delete'].includes(action))
      || (user?.permissions?.users?.includes('read') && user?.permissions?.tasks?.includes('read'));
    if (user && !canReadAll) {
      where.assignedTo = user.userId;
    }
    const items = await QuestionItem.findAll({
      where,
      include: [{ association: 'evidenceFiles' }],
      order: [['sequenceNumber', 'ASC']],
    });
    // Decrypt sensitive fields
    return Promise.all(items.map(async item => {
      const json = item.toJSON() as any;
      const activeEvidence = (json.evidenceFiles || [])
        .filter((file: any) => file.status === undefined || file.status === EvidenceStatus.ACTIVE);
      let historicalEvidence = activeEvidence
        .filter((file: any) => file.evidenceType === EvidenceType.HISTORICAL)
        .sort((a: any, b: any) => (b.version || 1) - (a.version || 1))[0] || null;
      if (!historicalEvidence && item.historicalEvidencePath) {
        historicalEvidence = (await this.ensureLegacyHistoricalEvidence(item))?.toJSON() || null;
      }
      json.historicalEvidence = historicalEvidence ? serializeEvidence(historicalEvidence) : null;
      json.evidenceFiles = activeEvidence
        .filter((file: any) => file.evidenceType !== EvidenceType.HISTORICAL)
        .map((file: any) => serializeEvidence(file));
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

    await auditLogService.log({
      userId, operationType: OperationType.UPDATE, resourceType: 'task',
      resourceId: taskId, success: true,
      operationDetails: '提交审计任务',
    });

    return task;
  }

  async uploadEvidence(
    questionItemId: string,
    file: Express.Multer.File,
    uploadedBy: string,
    tenantId: string,
    evidenceType: EvidenceType.CURRENT | EvidenceType.HISTORICAL,
  ) {
    const item = await QuestionItem.findByPk(questionItemId);
    if (!item) throw new Error('问卷条目不存在');
    if (file.size > 52428800) throw new Error('文件大小不能超过50MB');

    const validated = validateEvidence(file, tenantId);
    await fileStorage.put(validated.storageKey, file.buffer);
    const oldEvidence = evidenceType === EvidenceType.HISTORICAL
      ? await EvidenceFile.findOne({
        where: { questionItemId, evidenceType, status: EvidenceStatus.ACTIVE },
        order: [['version', 'DESC']],
      })
      : null;
    const version = await this.nextEvidenceVersion(questionItemId, evidenceType);
    const transaction = await sequelize.transaction();
    try {
      const evidence = await EvidenceFile.create({
        questionItemId,
        uploadedBy,
        originalFilename: validated.originalFilename,
        storedFilename: null,
        filePath: null,
        storageKey: validated.storageKey,
        sha256: validated.sha256,
        status: EvidenceStatus.ACTIVE,
        scanStatus: EvidenceScanStatus.CLEAN,
        isLocked: false,
        version,
        supersedesId: oldEvidence?.id || null,
        deletedAt: null,
        evidenceType,
        evidencePurpose: evidenceType === EvidenceType.HISTORICAL
          ? 'assessment_historical'
          : 'assessment_current',
        fileSize: file.size,
        mimeType: file.mimetype,
      }, { transaction });
      if (oldEvidence) {
        await oldEvidence.update({
          status: EvidenceStatus.DELETED,
          deletedAt: new Date(),
          deletedBy: uploadedBy,
        }, { transaction });
      }
      if (evidenceType === EvidenceType.HISTORICAL) {
        await item.update({ historicalEvidencePath: null }, { transaction });
      }
      await transaction.commit();
      await auditLogService.log({
        userId: uploadedBy,
        operationType: OperationType.CREATE,
        resourceType: 'evidence',
        resourceId: evidence.id,
        operationDetails: `上传${evidenceType === EvidenceType.HISTORICAL ? '历史' : '评估'}证据 v${version}，SHA-256: ${validated.sha256}`,
        success: true,
      }).catch(() => undefined);
      return serializeEvidence(evidence);
    } catch (error) {
      await transaction.rollback();
      await fileStorage.delete(validated.storageKey);
      throw error;
    }
  }

  async deleteEvidence(evidenceId: string, userId?: string) {
    const evidence = await EvidenceFile.findOne({ where: { id: evidenceId, status: EvidenceStatus.ACTIVE } });
    if (!evidence) throw new AppError(404, 'NOT_FOUND', '证据文件不存在');
    if (evidence.isLocked) throw new AppError(409, 'EVIDENCE_LOCKED', '证据已锁定，不能删除');
    await evidence.update({ status: EvidenceStatus.DELETED, deletedAt: new Date(), deletedBy: userId || null });
    if (userId) {
      await auditLogService.log({
        userId,
        operationType: OperationType.DELETE,
        resourceType: 'evidence',
        resourceId: evidence.id,
        operationDetails: `软删除证据 v${evidence.version}，物理文件保留用于审计追溯`,
        success: true,
      });
    }
  }

  async getHistoricalEvidence(questionItemId: string) {
    const item = await QuestionItem.findByPk(questionItemId);
    if (!item) return [];
    const evidence = await this.ensureLegacyHistoricalEvidence(item);
    return evidence ? [serializeEvidence(evidence)] : [];
  }

  async migrateLegacyHistoricalEvidence(): Promise<{ migrated: number; skipped: number; failed: number }> {
    const items = await QuestionItem.findAll({ where: { historicalEvidencePath: { [Op.ne]: null } } });
    const result = { migrated: 0, skipped: 0, failed: 0 };
    for (const item of items) {
      const existing = await EvidenceFile.findOne({
        where: {
          questionItemId: item.id,
          evidenceType: EvidenceType.HISTORICAL,
          status: EvidenceStatus.ACTIVE,
        },
      });
      if (existing) {
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

    for (const evidence of rows) {
      const target = evidence.storageKey
        ? fileStorage.absolutePath(evidence.storageKey)
        : evidence.filePath;
      if (!target || !fs.existsSync(target)) {
        await evidence.update({
          scanStatus: EvidenceScanStatus.ERROR,
          status: EvidenceStatus.QUARANTINED,
        });
        result.missing += 1;
        continue;
      }
      try {
        const stat = await fs.promises.stat(target);
        const inspection = await inspectEvidenceFile({
          path: target,
          originalname: evidence.originalFilename,
          mimetype: evidence.mimeType,
          size: stat.size,
        } as Express.Multer.File);
        await evidence.update({
          originalFilename: inspection.originalFilename,
          sha256: inspection.sha256,
          mimeType: inspection.mimeType,
          scanStatus: EvidenceScanStatus.CLEAN,
        });
        result.updated += 1;
      } catch {
        await evidence.update({
          scanStatus: EvidenceScanStatus.REJECTED,
          status: EvidenceStatus.QUARANTINED,
        });
        result.quarantined += 1;
      }
    }
    return result;
  }

  private async ensureLegacyHistoricalEvidence(item: QuestionItem): Promise<EvidenceFile | null> {
    const existing = await EvidenceFile.findOne({
      where: {
        questionItemId: item.id,
        evidenceType: EvidenceType.HISTORICAL,
        status: EvidenceStatus.ACTIVE,
      },
      order: [['version', 'DESC']],
    });
    if (existing || !item.historicalEvidencePath) return existing;

    const task = await AuditTask.findByPk(item.taskId, { attributes: ['createdBy'] });
    if (!task) return null;
    const legacyPath = item.historicalEvidencePath;
    const originalFilename = path.basename(legacyPath);
    let fileSize = 0;
    try {
      fileSize = fs.statSync(path.resolve(legacyPath)).size;
    } catch {
      // Preserve metadata even when the legacy file is currently unavailable.
    }
    return EvidenceFile.create({
      questionItemId: item.id,
      remediationActionId: null,
      evidenceType: EvidenceType.HISTORICAL,
      evidencePurpose: 'assessment_historical',
      version: 1,
      sha256: null,
      scanStatus: EvidenceScanStatus.CLEAN,
      status: EvidenceStatus.ACTIVE,
      isLocked: false,
      supersedesId: null,
      originalFilename,
      storedFilename: originalFilename,
      filePath: legacyPath,
      storageKey: null,
      fileSize,
      mimeType: this.inferMimeType(originalFilename),
      uploadedBy: task.createdBy,
      deletedAt: null,
      deletedBy: null,
    });
  }

  private async nextEvidenceVersion(
    questionItemId: string,
    evidenceType: EvidenceType,
  ): Promise<number> {
    const current = await EvidenceFile.max('version', { where: { questionItemId, evidenceType } });
    return Number(current || 0) + 1;
  }

  private inferMimeType(filename: string): string {
    const extension = path.extname(filename).toLowerCase();
    const types: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.csv': 'text/csv',
    };
    return types[extension] || 'application/octet-stream';
  }
}

export default new QuestionnaireService();
