import { QuestionItem, EvidenceFile, AuditTask, TaskStatus, AnswerStatus, AuditLog, OperationType } from '../models';
import { encrypt, decrypt } from '../utils/crypto';
import type { PermissionMatrix } from '../models/Role';
import { validateEvidence } from './evidence-security.service';
import { fileStorage } from './file-storage.service';
import { AppError } from '../utils/http';

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
    return items.map(item => {
      const json = item.toJSON() as any;
      json.evidenceFiles = (json.evidenceFiles || [])
        .filter((file: any) => file.status === 'active')
        .map(({ filePath: _path, storedFilename: _stored, storageKey: _key, ...safe }: any) => safe);
      if (json.currentStatusDescription) {
        json.currentStatusDescription = decrypt(json.currentStatusDescription);
      }
      return json;
    });
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

  async uploadEvidence(
    questionItemId: string,
    file: Express.Multer.File,
    uploadedBy: string,
    tenantId: string,
    evidenceType: 'current' | 'historical',
  ) {
    const item = await QuestionItem.findByPk(questionItemId);
    if (!item) throw new Error('问卷条目不存在');
    if (file.size > 52428800) throw new Error('文件大小不能超过50MB');

    const validated = validateEvidence(file, tenantId);
    await fileStorage.put(validated.storageKey, file.buffer);
    try {
      const evidence = await EvidenceFile.create({
        questionItemId,
        uploadedBy,
        originalFilename: validated.originalFilename,
        storedFilename: null,
        filePath: null,
        storageKey: validated.storageKey,
        sha256: validated.sha256,
        status: 'active',
        deletedAt: null,
        evidenceType,
        fileSize: file.size,
        mimeType: file.mimetype,
      });
      const { filePath: _path, storedFilename: _stored, storageKey: _key, ...safe } = evidence.toJSON() as any;
      return safe;
    } catch (error) {
      await fileStorage.delete(validated.storageKey);
      throw error;
    }
  }

  async deleteEvidence(evidenceId: string, userId?: string) {
    const evidence = await EvidenceFile.findOne({ where: { id: evidenceId, status: 'active' } });
    if (!evidence) throw new AppError(404, 'NOT_FOUND', '证据文件不存在');
    if (evidence.storageKey) await fileStorage.delete(evidence.storageKey);
    await evidence.update({ status: 'deleted', deletedAt: new Date() });
    if (userId) {
      await AuditLog.create({
        userId,
        operationType: OperationType.DELETE,
        resourceType: 'evidence',
        resourceId: evidence.id,
        operationDetails: '软删除证据文件',
        success: true,
      } as any);
    }
  }

  async getHistoricalEvidence(questionItemId: string) {
    const item = await QuestionItem.findByPk(questionItemId);
    if (!item) return [];
    const rows = await EvidenceFile.findAll({
      where: { questionItemId, evidenceType: 'historical', status: 'active' },
      order: [['uploadedAt', 'DESC']],
    });
    return rows.map((row) => {
      const { filePath: _path, storedFilename: _stored, storageKey: _key, ...safe } = row.toJSON() as any;
      return safe;
    });
  }
}

export default new QuestionnaireService();
