import { useState, useEffect } from 'react';
import { Table, Tag, Button, Typography } from 'antd';
import { FormOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { MY_TASK_USER_STATUS } from '../../constants/status';

const { Title } = Typography;

export default function MyTasks() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const currentUserId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    setLoading(true);
    apiClient.get('/tasks?my=true').then((res: any) => {
      setTasks(res.data?.items || []);
    }).finally(() => setLoading(false));
  }, []);

  const getUserStatus = (record: any) => {
    const isReturned = record.returnedAssignees?.includes(currentUserId);
    if (isReturned) return { text: '被退回', color: 'red' };
    return MY_TASK_USER_STATUS.get(record);
  };

  const canEdit = (record: any): boolean => {
    const my = record._myStats || { myTotal: 0, myAnswered: 0 };
    if (my.myTotal === 0) return false;
    // 被退回 → 可以重新填写
    if (record.returnedAssignees?.includes(currentUserId)) return true;
    // 还有未答的题目
    if (my.myAnswered < my.myTotal) return true;
    // 全答完 → 不可编辑
    return false;
  };

  const columns = [
    { title: '评估方式', dataIndex: 'assessmentType' },
    { title: '评估对象', dataIndex: 'assessmentTarget' },
    {
      title: '状态', render: (_: any, record: any) => {
        const s = getUserStatus(record);
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    { title: '退回原因', dataIndex: 'returnReason', render: (v: string) => v || '-' },
    {
      title: '操作', render: (_: any, record: any) => (
        <Button
          size="small"
          type={canEdit(record) ? 'primary' : undefined}
          icon={canEdit(record) ? <FormOutlined /> : undefined}
          onClick={() => navigate(`/my-tasks/${record.id}`)}
        >
          {canEdit(record) ? '填写' : '查看'}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 24 }}>我的审计任务</Title>
      <Table columns={columns} dataSource={tasks} rowKey="id" loading={loading} />
    </div>
  );
}
