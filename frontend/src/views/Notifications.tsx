import { useState, useEffect } from 'react';
import { List, Typography, Tag, Button, Space, message } from 'antd';
import apiClient from '../api/client';

const { Title, Text } = Typography;

export default function Notifications() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = () => {
    setLoading(true);
    apiClient.get('/notifications').then((res: any) => {
      setNotifications(res.data?.items || []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchNotifications(); }, []);

  const handleMarkRead = async (id: string) => {
    try {
      await apiClient.put(`/notifications/${id}/read`);
      message.success('已标记为已读');
      fetchNotifications();
    } catch { message.error('操作失败'); }
  };

  const typeMap: Record<string, { color: string; text: string }> = {
    task_assigned: { color: 'blue', text: '任务分配' },
    task_returned: { color: 'red', text: '任务退回' },
    task_submitted: { color: 'green', text: '任务提交' },
  };

  return (
    <div>
      <Title level={3} style={{ fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 24 }}>通知</Title>
      <List
        loading={loading}
        dataSource={notifications}
        renderItem={(item: any) => (
          <List.Item
            extra={
              !item.isRead && (
                <Button size="small" onClick={() => handleMarkRead(item.id)}>标记已读</Button>
              )
            }
          >
            <List.Item.Meta
              title={
                <Space>
                  <Tag color={typeMap[item.notificationType]?.color || 'default'}>
                    {typeMap[item.notificationType]?.text || item.notificationType}
                  </Tag>
                  {item.title}
                  {!item.isRead && <Tag color="red">未读</Tag>}
                </Space>
              }
              description={
                <>
                  <Text>{item.content}</Text>
                  <br />
                  <Text type="secondary">{new Date(item.createdAt).toLocaleString()}</Text>
                </>
              }
            />
          </List.Item>
        )}
      />
    </div>
  );
}
