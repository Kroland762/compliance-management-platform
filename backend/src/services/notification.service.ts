import { Notification, NotificationType } from '../models';
import { parsePagination, pagination } from '../utils/pagination';
import { AppError } from '../utils/http';
import type { Transaction } from 'sequelize';

class NotificationService {
  async create(
    data: { userId: string; taskId: string | null; type: NotificationType; title: string; content: string },
    transaction?: Transaction,
  ) {
    return Notification.create({
      userId: data.userId,
      taskId: data.taskId,
      notificationType: data.type,
      title: data.title,
      content: data.content,
    } as any, { transaction });
  }

  async getNotifications(userId: string, query: { page?: number; pageSize?: number; isRead?: boolean }) {
    const { page, pageSize } = parsePagination(query);
    const { isRead } = query;
    const where: any = { userId };
    if (isRead !== undefined) where.isRead = isRead;

    const { count, rows } = await Notification.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return {
      items: rows,
      pagination: pagination(page, pageSize, count),
    };
  }

  async getUnreadCount(userId: string) {
    return Notification.count({ where: { userId, isRead: false } });
  }

  async markAsRead(id: string, userId: string) {
    const notif = await Notification.findOne({ where: { id, userId } });
    if (!notif) throw new AppError(404, 'NOT_FOUND', '通知不存在');
    notif.isRead = true;
    notif.readAt = new Date();
    await notif.save();
    return notif;
  }

  async notifyTaskAssigned(userId: string, taskId: string, target: string) {
    return this.create({
      userId, taskId, type: NotificationType.TASK_ASSIGNED,
      title: '新任务分配', content: `您有一个新的审计任务：${target}`,
    });
  }

  async notifyTaskReturned(userId: string, taskId: string, reason: string) {
    return this.create({
      userId, taskId, type: NotificationType.TASK_RETURNED,
      title: '任务已退回', content: `您的审计任务已被退回，原因：${reason}`,
    });
  }

  async notifyTaskSubmitted(auditorId: string, taskId: string, target: string) {
    return this.create({
      userId: auditorId, taskId, type: NotificationType.TASK_SUBMITTED,
      title: '任务待审阅', content: `普通用户已提交审计任务：${target}`,
    });
  }
}

export default new NotificationService();
