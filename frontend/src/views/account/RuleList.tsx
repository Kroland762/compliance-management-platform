import { useState, useEffect } from 'react';
import { Table, Button, Tabs, Tag, Switch, Typography, Space, message, Popconfirm, Select } from 'antd';
import { PlusOutlined, EyeOutlined, EditOutlined, DeleteOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { ruleApi, type Rule } from '../../api/account';
import { getApiErrorMessage } from '../../utils/error';
import RuleForm from './RuleForm';

const { Title, Text } = Typography;

const severityColors: Record<string, string> = { HIGH: 'red', MEDIUM: 'orange', LOW: 'green' };
const severityLabels: Record<string, string> = { HIGH: '高', MEDIUM: '中', LOW: '低' };

export default function RuleList() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'BUILTIN' | 'CUSTOM'>('BUILTIN');
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [toggling, setToggling] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<any>(null);

  const fetchRules = () => {
    setLoading(true);
    const params: any = { type: activeTab };
    if (severityFilter) params.severity = severityFilter;
    ruleApi.list(params)
      .then((res: any) => setRules(res.data?.items || []))
      .catch(() => message.error('获取规则列表失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchRules(); }, [activeTab, severityFilter]);

  const handleToggle = async (id: string) => {
    setToggling(id);
    try {
      await ruleApi.toggle(id);
      message.success('状态已更新');
      fetchRules();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '操作失败'));
    } finally {
      setToggling(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await ruleApi.delete(id);
      message.success('规则已删除');
      fetchRules();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '删除失败'));
    }
  };

  const columns = [
    {
      title: '名称', dataIndex: 'name', width: 180,
      render: (v: string, record: Rule) => (
        <a onClick={() => navigate(`/account-audit/rules/${record.id}`)} style={{ fontWeight: 500 }}>{v}</a>
      ),
    },
    {
      title: '类型', dataIndex: 'ruleType', width: 80,
      render: (v: string) => (
        <Tag color={v === 'BUILTIN' ? 'blue' : 'purple'} style={{ borderRadius: 6 }}>
          {v === 'BUILTIN' ? '内置' : '自定义'}
        </Tag>
      ),
    },
    {
      title: '严重度', dataIndex: 'severity', width: 80,
      render: (v: string) => <Tag color={severityColors[v]}>{severityLabels[v]}</Tag>,
    },
    {
      title: '描述', dataIndex: 'description', ellipsis: true,
      render: (v: string) => <Text style={{ fontSize: 13 }}>{v || '-'}</Text>,
    },
    {
      title: '启用', dataIndex: 'isActive', width: 70, align: 'center' as const,
      render: (v: boolean, record: Rule) => (
        <Switch
          size="small"
          checked={v}
          loading={toggling === record.id}
          onChange={() => handleToggle(record.id)}
        />
      ),
    },
    { title: '关联任务', dataIndex: 'taskCount', width: 80, align: 'center' as const },
    {
      title: '操作', width: 140,
      render: (_: any, record: Rule) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/account-audit/rules/${record.id}`)} />
          {record.ruleType === 'CUSTOM' && (
            <>
              <Button size="small" icon={<EditOutlined />}
              onClick={() => { setEditingRule(record); setFormOpen(true); }} />
              <Popconfirm title="确定删除？" icon={<ExclamationCircleOutlined style={{ color: '#FF3B30' }} />}
                onConfirm={() => handleDelete(record.id)} cancelText="取消" okText="确认">
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  const tabItems = [
    { key: 'BUILTIN', label: '内置规则' },
    { key: 'CUSTOM', label: '自定义规则' },
  ];

  return (
    <div>
      <div className="filter-toolbar">
        <div className="filter-toolbar-content">
          <Select
            placeholder="严重度"
            value={severityFilter || undefined}
            onChange={v => setSeverityFilter(v || '')}
            allowClear
            style={{ width: 110 }}
            options={[
              { value: 'high', label: '高' },
              { value: 'medium', label: '中' },
              { value: 'low', label: '低' },
            ]}
          />
          <Button type="primary" icon={<PlusOutlined />}
            onClick={() => { setEditingRule(null); setFormOpen(true); }}>
            创建规则
          </Button>
        </div>
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.8)',
        backdropFilter: 'blur(20px)',
        borderRadius: 14,
        border: '0.5px solid rgba(0,0,0,0.06)',
        padding: '8px 16px',
      }}>
        <Tabs
          activeKey={activeTab}
          onChange={key => setActiveTab(key as 'BUILTIN' | 'CUSTOM')}
          items={tabItems}
        />
        <Table columns={columns} dataSource={rules} rowKey="id" loading={loading} size="small"
          pagination={{ pageSize: 20 }} />
      </div>
      <RuleForm
        open={formOpen}
        editingRule={editingRule}
        onClose={() => { setFormOpen(false); setEditingRule(null); }}
        onSuccess={() => { setFormOpen(false); setEditingRule(null); fetchRules(); }}
      />
    </div>
  );
}
