import { useEffect, useState } from 'react';
import { Drawer, Descriptions, Tag, Typography, Button, Space, Select, Input, Timeline, message, Spin, Divider } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import { problemApi, type Problem } from '../../api/account';
import { getApiErrorMessage } from '../../utils/error';
import { useAuthStore } from '../../store/auth';

const { Text } = Typography;
const { TextArea } = Input;

const severityColors: Record<string, string> = { HIGH: 'red', MEDIUM: 'orange', LOW: 'green' };
const severityLabels: Record<string, string> = { HIGH: '高', MEDIUM: '中', LOW: '低' };
const statusColors: Record<string, string> = { PENDING: 'red', PROCESSING: 'orange', RESOLVED: 'green', AUTO_RESOLVED: 'blue', FALSE_POSITIVE: 'default', IGNORED: 'default' };
const statusLabels: Record<string, string> = { PENDING: '待处理', PROCESSING: '处理中', RESOLVED: '已解决', AUTO_RESOLVED: '自动修复', FALSE_POSITIVE: '误报', IGNORED: '已忽略' };

interface Props {
  visible: boolean;
  problemId: string | null;
  onClose: () => void;
  onStatusUpdated: () => void;
}

export default function ProblemDetail({ visible, problemId, onClose, onStatusUpdated }: Props) {
  const canUpdate = useAuthStore((state) => state.hasPermission('problems', 'update'));
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [newStatus, setNewStatus] = useState<string>('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (visible && problemId) {
      setLoading(true);
      setNewStatus('');
      setNotes('');
      problemApi.get(problemId)
        .then((res: any) => {
          setProblem(res.data);
          setNewStatus(res.data.status || '');
        })
        .catch(() => message.error('获取问题详情失败'))
        .finally(() => setLoading(false));
    }
  }, [visible, problemId]);

  const handleStatusUpdate = async () => {
    if (!problem || !newStatus) return;
    setUpdating(true);
    try {
      await problemApi.updateStatus(problem.id, { status: newStatus, notes: notes || undefined });
      message.success('状态已更新');
      onStatusUpdated();
      // Refresh problem
      const res: any = await problemApi.get(problem.id);
      setProblem(res.data);
      setNotes('');
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '更新失败'));
    } finally {
      setUpdating(false);
    }
  };

  const statusOptions = [
    { value: 'PENDING', label: '待处理' }, { value: 'PROCESSING', label: '处理中' },
    { value: 'RESOLVED', label: '已解决' }, { value: 'FALSE_POSITIVE', label: '误报' }, { value: 'IGNORED', label: '已忽略' },
  ];

  return (
    <Drawer
      title={problem ? `问题详情` : '加载中...'}
      open={visible}
      onClose={onClose}
      width={480}
      placement="right"
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : problem ? (
        <div>
          {/* Basic Info */}
          <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="账户ID">
              <Text code>{problem.accountId}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="账户名">{problem.accountName}</Descriptions.Item>
            <Descriptions.Item label="规则">{problem.ruleName}</Descriptions.Item>
            <Descriptions.Item label="问题描述">{problem.problemDescription}</Descriptions.Item>
            <Descriptions.Item label="严重度">
              <Tag color={severityColors[problem.severity]}>{severityLabels[problem.severity]}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={statusColors[problem.status]}>{statusLabels[problem.status]}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="首次检测">
              {new Date(problem.firstDetectedAt).toLocaleString('zh-CN')}
            </Descriptions.Item>
            <Descriptions.Item label="最近检测">
              {problem.lastSeenAt ? new Date(problem.lastSeenAt).toLocaleString('zh-CN') : '-'}
            </Descriptions.Item>
            {problem.resolvedAt && (
              <Descriptions.Item label="解决时间">
                {new Date(problem.resolvedAt).toLocaleString('zh-CN')}
              </Descriptions.Item>
            )}
            {problem.resolutionNotes && (
              <Descriptions.Item label="解决备注">{problem.resolutionNotes}</Descriptions.Item>
            )}
          </Descriptions>

          <Divider />

          {/* Status Update */}
          {canUpdate && <div style={{ marginBottom: 20 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>更新状态</Text>
            <Space direction="vertical" style={{ width: '100%' }} size={10}>
              <Select
                value={newStatus || undefined}
                onChange={v => setNewStatus(v)}
                style={{ width: '100%' }}
                options={statusOptions}
                placeholder="选择新状态"
              />
              <TextArea
                rows={2}
                placeholder="备注（可选）"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
              <Button type="primary" loading={updating} onClick={handleStatusUpdate} block
                disabled={!newStatus || newStatus === problem.status}>
                更新状态
              </Button>
            </Space>
          </div>}

          <Divider />

          {/* Status History Timeline */}
          {problem.statusHistory && problem.statusHistory.length > 0 && (
            <div>
              <Text strong style={{ display: 'block', marginBottom: 12 }}>状态历史</Text>
              <Timeline
                items={problem.statusHistory.map(h => ({
                  color: h.toStatus === 'RESOLVED' ? 'green' : h.toStatus === 'PENDING' ? 'red' : 'blue',
                  dot: <ClockCircleOutlined style={{ fontSize: 12 }} />,
                  children: (
                    <div>
                      <div>
                        <Tag color={statusColors[h.toStatus]} style={{ borderRadius: 4 }}>
                          {statusLabels[h.toStatus]}
                        </Tag>
                        <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                          {new Date(h.changedAt).toLocaleString('zh-CN')}
                        </Text>
                      </div>
                      <div style={{ fontSize: 12, color: '#8E8E93', marginTop: 2 }}>
                        {h.changedBy}
                        {h.notes ? ` — ${h.notes}` : ''}
                      </div>
                    </div>
                  ),
                }))}
              />
            </div>
          )}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 40, color: '#8E8E93' }}>问题不存在</div>
      )}
    </Drawer>
  );
}
