import { Notification, NotificationType } from '../models';

class NotificationService {
  async create(data: { userId: string; taskId: string; type: NotificationType; title: string; content: string }) {
    return Notification.create({
      userId: data.userId,
      taskId: data.taskId,
      notificationType: data.type,
      title: data.title,
      content: data.content,
    } as any);
  }

  async getNotifications(userId: string, query: { page?: number; pageSize?: number; isRead?: boolean }) {
    const { page = 1, pageSize = 20, isRead } = query;
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
      pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
    };
  }

  async getUnreadCount(userId: string) {
    return Notification.count({ where: { userId, isRead: false } });
  }

  async markAsRead(id: string) {
    const notif = await Notification.findByPk(id);
    if (!notif) throw new Error('通知不存在');
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
