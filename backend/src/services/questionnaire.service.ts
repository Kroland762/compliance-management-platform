import { QuestionItem, EvidenceFile, AuditTask, TaskStatus, AnswerStatus, AuditLog, OperationType } from '../models';
import { encrypt, decrypt } from '../utils/crypto';

class QuestionnaireService {
  async getQuestions(taskId: string, userId?: string) {
    const where: any = { taskId };
    // 如果传了 userId 且不是审计员/管理员，则按 assignedTo 过滤
    if (userId) {
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
    return items.map(item => {
      const json = item.toJSON() as any;
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

  async uploadEvidence(questionItemId: string, file: Express.Multer.File, uploadedBy: string) {
    const item = await QuestionItem.findByPk(questionItemId);
    if (!item) throw new Error('问卷条目不存在');
    if (file.size > 52428800) throw new Error('文件大小不能超过50MB');

    return EvidenceFile.create({
      questionItemId, uploadedBy,
      // 修复中文文件名乱码
      originalFilename: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      storedFilename: file.filename,
      filePath: file.path,
      fileSize: file.size,
      mimeType: file.mimetype,
    } as any);
  }

  async deleteEvidence(evidenceId: string) {
    const evidence = await EvidenceFile.findByPk(evidenceId);
    if (!evidence) throw new Error('证据文件不存在');
    const fs = await import('fs');
    fs.unlink(evidence.filePath, () => {});
    await evidence.destroy();
  }

  async getHistoricalEvidence(questionItemId: string) {
    const item = await QuestionItem.findByPk(questionItemId);
    if (!item || !item.historicalEvidencePath) return [];
    return [{ path: item.historicalEvidencePath, name: '历史证据' }];
  }
}

export default new QuestionnaireService();
