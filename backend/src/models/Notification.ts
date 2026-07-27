import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database';
import { NotificationType } from './enums';
import User from './User';
import AuditTask from './AuditTask';

interface NotificationAttributes {
  id: string;
  userId: string;
  taskId: string;
  notificationType: NotificationType;
  title: string;
  content: string;
  isRead: boolean;
  createdAt: Date;
  readAt: Date | null;
}

type CreationAttributes = Optional<NotificationAttributes, 'id' | 'createdAt' | 'readAt'>;

class Notification extends Model<NotificationAttributes, CreationAttributes> implements NotificationAttributes {
  declare id: string;
  declare userId: string;
  declare taskId: string;
  declare notificationType: NotificationType;
  declare title: string;
  declare content: string;
  declare isRead: boolean;
  declare createdAt: Date;
  declare readAt: Date | null;
}

Notification.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false, references: { model: User, key: 'id' } },
    taskId: { type: DataTypes.UUID, allowNull: false, references: { model: AuditTask, key: 'id' } },
    notificationType: { type: DataTypes.STRING(30), allowNull: false, validate: { isIn: [Object.values(NotificationType)] } },
    title: { type: DataTypes.STRING(200), allowNull: false },
    content: { type: DataTypes.TEXT, allowNull: false },
    isRead: { type: DataTypes.BOOLEAN, defaultValue: false },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    readAt: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, tableName: 'notifications', timestamps: false },
);

export default Notification;
