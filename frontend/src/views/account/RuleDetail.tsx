import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Typography, Button, Descriptions, Tag, Space, Spin, message, Card, Switch, Modal, InputNumber, DatePicker, Select } from 'antd';
import { ArrowLeftOutlined, EditOutlined, SettingOutlined } from '@ant-design/icons';
import { ruleApi, type Rule } from '../../api/account';
import { getApiErrorMessage } from '../../utils/error';
import RuleForm from './RuleForm';
import dayjs from 'dayjs';
import { useAuthStore } from '../../store/auth';

const { Title, Text } = Typography;

const severityColors: Record<string, string> = { HIGH: 'red', MEDIUM: 'orange', LOW: 'green' };
const severityLabels: Record<string, string> = { HIGH: '高', MEDIUM: '中', LOW: '低' };

export default function RuleDetail() {
  const can = useAuthStore((state) => state.hasPermission);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [rule, setRule] = useState<Rule | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [paramEditOpen, setParamEditOpen] = useState(false);
  const [paramValues, setParamValues] = useState<Record<string, any>>({});
  const [paramSaving, setParamSaving] = useState(false);

  const fetchRule = () => {
    if (!id) return;
    setLoading(true);
    ruleApi.get(id)
      .then((res: any) => setRule(res.data))
      .catch(() => message.error('获取规则详情失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchRule(); }, [id]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>;
  }

  if (!rule) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#8E8E93' }}>规则不存在</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/account-audit/rules')} type="text" />
          <Title level={3} style={{ fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 24 }}>{rule.name}</Title>
          <Tag color={rule.ruleType === 'BUILTIN' ? 'blue' : 'purple'}>
            {rule.ruleType === 'BUILTIN' ? '内置' : '自定义'}
          </Tag>
          <Tag color={severityColors[rule.severity]}>{severityLabels[rule.severity]}</Tag>
        </div>
        {rule.ruleType === 'CUSTOM' && can('rules', 'update') && (
          <Button icon={<EditOutlined />} onClick={() => setEditOpen(true)}>编辑规则</Button>
        )}
      </div>

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {/* Basic Info */}
        <Card
          title={<Text strong>基本信息</Text>}
          style={{
            background: 'rgba(255,255,255,0.8)',
            borderRadius: 14,
            border: '0.5px solid rgba(0,0,0,0.06)',
          }}
        >
          <Descriptions column={2} size="small">
            <Descriptions.Item label="规则名称">{rule.name}</Descriptions.Item>
            <Descriptions.Item label="类型">
              <Tag color={rule.ruleType === 'BUILTIN' ? 'blue' : 'purple'}>
                {rule.ruleType === 'BUILTIN' ? '内置规则' : '自定义规则'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="严重度">
              <Tag color={severityColors[rule.severity]}>{severityLabels[rule.severity]}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="启用状态">
              <Switch size="small" checked={rule.isActive} disabled />
            </Descriptions.Item>
            <Descriptions.Item label="描述" span={2}>{rule.description || '-'}</Descriptions.Item>
            <Descriptions.Item label="关联任务数">{rule.taskCount}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{new Date(rule.createdAt).toLocaleString('zh-CN')}</Descriptions.Item>
            <Descriptions.Item label="更新时间" span={2}>{new Date(rule.updatedAt).toLocaleString('zh-CN')}</Descriptions.Item>
          </Descriptions>
        </Card>

        {/* Conditions */}
        <Card
          title={<Text strong>检测条件</Text>}
          style={{
            background: 'rgba(255,255,255,0.8)',
            borderRadius: 14,
            border: '0.5px solid rgba(0,0,0,0.06)',
          }}
        >
          {rule.conditionLogic && Object.keys(rule.conditionLogic).length > 0 ? (
            <pre style={{ fontSize: 12, background: '#F5F5F7', padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(rule.conditionLogic, null, 2)}
            </pre>
          ) : (
            <Text type="secondary">暂无检测条件</Text>
          )}
        </Card>

        {/* Parameters */}
        {rule.paramsConfig && Object.keys(rule.paramsConfig).length > 0 && (
          <Card
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong>参数配置</Text>
                {can('rules', 'update') && <Button
                  size="small"
                  icon={<SettingOutlined />}
                  onClick={() => {
                    setParamValues({ ...rule.paramsConfig });
                    setParamEditOpen(true);
                  }}
                >
                  编辑参数
                </Button>}
              </div>
            }
            style={{
              background: 'rgba(255,255,255,0.8)',
              borderRadius: 14,
              border: '0.5px solid rgba(0,0,0,0.06)',
            }}
          >
            <pre style={{ fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(rule.paramsConfig, null, 2)}
            </pre>
          </Card>
        )}

        {/* Linked Tasks */}
        {rule.linkedTaskIds && rule.linkedTaskIds.length > 0 && (
          <Card
            title={<Text strong>关联任务</Text>}
            style={{
              background: 'rgba(255,255,255,0.8)',
              borderRadius: 14,
              border: '0.5px solid rgba(0,0,0,0.06)',
            }}
          >
            <Space wrap>
              {rule.linkedTaskIds.map(taskId => (
                <Tag key={taskId} color="blue" style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/account-audit/tasks/${taskId}/history`)}>
                  {taskId}
                </Tag>
              ))}
            </Space>
          </Card>
        )}
      </Space>

      {editOpen && (
        <RuleForm
          open={editOpen}
          editingRule={rule}
          onClose={() => setEditOpen(false)}
          onSuccess={() => { setEditOpen(false); fetchRule(); }}
        />
      )}

      {/* 参数编辑弹窗 */}
      <Modal
        title="编辑参数"
        open={paramEditOpen}
        onCancel={() => setParamEditOpen(false)}
        onOk={async () => {
          if (!id) return;
          setParamSaving(true);
          try {
            await ruleApi.updateParams(id, paramValues);
            message.success('参数已更新');
            setParamEditOpen(false);
            fetchRule();
          } catch (err: any) {
            message.error(getApiErrorMessage(err, '更新参数失败'));
          } finally {
            setParamSaving(false);
          }
        }}
        confirmLoading={paramSaving}
        okText="保存"
        cancelText="取消"
      >
        {/* LONG_INACTIVE: 天数 */}
        {rule.builtinKey === 'LONG_INACTIVE' && (
          <div style={{ marginTop: 8 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
              长期未活跃判断
            </Typography.Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Typography.Text>超过</Typography.Text>
              <InputNumber
                min={1}
                value={paramValues.days ?? 180}
                onChange={v => setParamValues({ ...paramValues, days: v })}
                style={{ width: 100 }}
              />
              <Typography.Text>天未登录/操作的账户视为长期未活跃</Typography.Text>
            </div>
          </div>
        )}

        {/* HIGH_PRIV_NO_MFA: 关键词 */}
        {rule.builtinKey === 'HIGH_PRIV_NO_MFA' && (
          <div style={{ marginTop: 8 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
              高权限关键词
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              账户名称包含以下任一关键词的视为高权限账户
            </Typography.Text>
            <Select
              mode="tags"
              style={{ width: '100%' }}
              placeholder="输入关键词后回车添加，如 admin, root"
              value={paramValues.keywords || []}
              onChange={vals => setParamValues({ ...paramValues, keywords: vals })}
            />
          </div>
        )}

        {/* ABNORMAL_CREATE_TIME: 系统上线时间 */}
        {rule.builtinKey === 'ABNORMAL_CREATE_TIME' && (
          <div style={{ marginTop: 8 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
              系统上线时间
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              早于此日期创建的账户视为异常
            </Typography.Text>
            <DatePicker
              style={{ width: '100%' }}
              placeholder="选择系统上线时间"
              value={paramValues.thresholdDate ? dayjs(paramValues.thresholdDate) : null}
              onChange={dayjsValue => setParamValues({
                ...paramValues,
                thresholdDate: dayjsValue ? dayjsValue.format('YYYY-MM-DD') : null,
              })}
            />
          </div>
        )}

        {/* Generic: JSON editor for other built-in rules */}
        {!['LONG_INACTIVE', 'HIGH_PRIV_NO_MFA', 'ABNORMAL_CREATE_TIME'].includes(rule.builtinKey || '') && (
          <div style={{ marginTop: 8 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
              参数配置 (JSON)
            </Typography.Text>
            <pre style={{
              fontSize: 12, margin: 0, padding: 12,
              background: '#F5F5F7', borderRadius: 8,
              whiteSpace: 'pre-wrap', fontFamily: 'monospace',
            }}>
              {JSON.stringify(rule.paramsConfig, null, 2)}
            </pre>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
              其他内置规则的参数请通过 JSON 编辑模式调整
            </Typography.Text>
          </div>
        )}
      </Modal>
    </div>
  );
}
