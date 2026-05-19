import { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, Button, Typography, message, Space, Divider, InputNumber, AutoComplete, Segmented, Card } from 'antd';
import { PlusOutlined, DeleteOutlined, GroupOutlined } from '@ant-design/icons';
import { ruleApi } from '../../api/account';
import { getApiErrorMessage } from '../../utils/error';

const { Text } = Typography;

const FIELDS = [
  { value: 'accountId', label: '账户ID' },
  { value: 'accountName', label: '账户名称' },
  { value: 'accountPermission', label: '账户权限' },
  { value: 'createdTime', label: '创建时间' },
  { value: 'lastLoginTime', label: '最后登录' },
  { value: 'mfaEnabled', label: 'MFA状态' },
  { value: 'accountStatus', label: '账户状态' },
];

const OPERATORS = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'contains_any', label: '含任一关键词' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
  { value: 'lt_days', label: '距今超过N天' },
  { value: 'lt_date', label: '早于某日期' },
  { value: 'not_true', label: '未开启/为空' },
  { value: 'is_null', label: '为空' },
  { value: 'is_not_null', label: '不为空' },
];

const DAYS_OPERATORS = ['lt_days'];
const DATE_OPERATORS = ['lt_date'];
const NO_VALUE_OPERATORS = ['not_true', 'is_null', 'is_not_null'];
const KEYWORD_OPERATORS = ['contains_any'];

let _gid = 1;
function gid() { return String(Date.now()) + '_' + (_gid++); }
let _cid = 1;
function cid() { return 'c_' + (_cid++); }

interface CondItem {
  id: string;
  field: string;
  operator: string;
  value: string;
  days?: number;
}

interface CondGroup {
  id: string;
  operator: 'AND' | 'OR';
  conditions: CondItem[];
  groups: CondGroup[];
}

interface Props {
  open: boolean;
  editingRule?: any;
  onClose: () => void;
  onSuccess: () => void;
}

export default function RuleForm({ open, editingRule, onClose, onSuccess }: Props) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [root, setRoot] = useState<CondGroup>(emptyGroup());

  function emptyGroup(): CondGroup {
    return { id: gid(), operator: 'AND', conditions: [emptyCond()], groups: [] };
  }
  function emptyCond(): CondItem {
    return { id: cid(), field: '', operator: '', value: '' };
  }

  useEffect(() => {
    if (open) {
      if (editingRule) {
        form.setFieldsValue({
          name: editingRule.name,
          severity: editingRule.severity,
          description: editingRule.description,
        });
        setRoot(parseLogic(editingRule.conditionLogic || {}));
      } else {
        form.resetFields();
        setRoot(emptyGroup());
      }
    }
  }, [open, editingRule]);

  // ---- 条件操作 ----
  const addCond = (group: CondGroup) => {
    group.conditions.push(emptyCond());
    setRoot({ ...root });
  };
  const removeCond = (group: CondGroup, id: string) => {
    if (group.conditions.length + group.groups.length <= 1) return;
    group.conditions = group.conditions.filter(c => c.id !== id);
    setRoot({ ...root });
  };
  const updateCond = (group: CondGroup, id: string, field: keyof CondItem, value: any) => {
    group.conditions = group.conditions.map(c => c.id === id ? { ...c, [field]: value } : c);
    setRoot({ ...root });
  };

  // ---- 子组操作 ----
  const addSubGroup = (group: CondGroup) => {
    if (group.groups.length >= 3) { message.warning('最多嵌套 3 层'); return; }
    group.groups.push({ id: gid(), operator: 'OR', conditions: [emptyCond()], groups: [] });
    setRoot({ ...root });
  };
  const removeGroup = (parent: CondGroup, gid: string) => {
    if (parent.conditions.length + parent.groups.length <= 1) return;
    parent.groups = parent.groups.filter(g => g.id !== gid);
    setRoot({ ...root });
  };
  const toggleGroupOp = (group: CondGroup) => {
    group.operator = group.operator === 'AND' ? 'OR' : 'AND';
    setRoot({ ...root });
  };

  // ---- 构建/解析 conditionLogic ----
  function buildGroup(g: CondGroup): any {
    const children: any[] = [
      ...g.conditions.filter(c => c.field && c.operator).map(buildLeaf),
      ...g.groups.map(buildGroup),
    ];
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return { operator: g.operator, conditions: children };
  }

  function parseLogic(node: any): CondGroup {
    if (!node || typeof node !== 'object') return emptyGroup();
    // 读取 operator 兼容旧 logic 键
    const op = (node.operator || node.logic || 'AND').toUpperCase();
    if ((op === 'AND' || op === 'OR') && Array.isArray(node.conditions)) {
      const items: CondItem[] = [];
      const groups: CondGroup[] = [];
      for (const child of node.conditions) {
        const childOp = (child.operator || child.logic || '').toUpperCase();
        if ((childOp === 'AND' || childOp === 'OR') && Array.isArray(child.conditions)) {
          groups.push(parseLogic(child));
        } else if (child.field && child.operator) {
          items.push(parseLeaf(child));
        }
      }
      return { id: gid(), operator: op as 'AND' | 'OR', conditions: items.length ? items : [emptyCond()], groups };
    }
    // 单叶子节点
    if (node.field && node.operator) {
      return { id: gid(), operator: 'AND', conditions: [parseLeaf(node)], groups: [] };
    }
    return emptyGroup();
  }

  // ---- 提交 ----
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const logic = buildGroup(root);
      if (!logic) { message.warning('请至少配置一条检测条件'); return; }
      setLoading(true);

      const payload = {
        name: values.name,
        ruleType: 'CUSTOM' as const,
        severity: values.severity,
        description: values.description,
        conditionLogic: logic,
        isActive: true,
      };

      if (editingRule) {
        await ruleApi.update(editingRule.id, payload);
        message.success('规则已更新');
      } else {
        await ruleApi.create(payload);
        message.success('规则已创建');
      }
      onSuccess();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(getApiErrorMessage(err, editingRule ? '更新失败' : '创建失败'));
    } finally { setLoading(false); }
  };

  // ---- 渲染条件组（递归）----
  function renderGroup(group: CondGroup, depth: number, parent?: CondGroup) {
    const isSub = depth > 0;
    const borderColor = group.operator === 'OR' ? '#FF9500' : '#007AFF';
    const bgColor = group.operator === 'OR' ? '#FFF8F0' : '#F0F5FF';

    return (
      <Card
        key={group.id}
        size="small"
        style={{
          marginBottom: 8,
          marginLeft: isSub ? 16 : 0,
          borderLeft: `3px solid ${borderColor}`,
          background: bgColor,
          borderRadius: 10,
        }}
        title={
          <Space size={8}>
            <Segmented
              size="small"
              value={group.operator}
              onChange={() => toggleGroupOp(group)}
              options={[
                { value: 'AND', label: 'AND 全部满足' },
                { value: 'OR', label: 'OR 任一满足' },
              ]}
            />
            {isSub && (
              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeGroup(parent!, group.id)}>
                删除组
              </Button>
            )}
          </Space>
        }
        extra={
          <Button size="small" icon={<GroupOutlined />} onClick={() => addSubGroup(group)}>
            添加条件组
          </Button>
        }
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {group.conditions.map((cond, idx) => {
            const needsDays = DAYS_OPERATORS.includes(cond.operator);
            const needsDate = DATE_OPERATORS.includes(cond.operator);
            const noValue = NO_VALUE_OPERATORS.includes(cond.operator);
            const needsKeywords = KEYWORD_OPERATORS.includes(cond.operator);
            const totalInGroup = group.conditions.length + group.groups.length;

            return (
              <div key={cond.id} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Text type="secondary" style={{ fontSize: 11, width: 20, flexShrink: 0, textAlign: 'center' }}>
                  {idx === 0 ? '' : group.operator === 'OR' ? '或' : '且'}
                </Text>
                <AutoComplete placeholder="字段" value={cond.field || ''}
                  onChange={v => updateCond(group, cond.id, 'field', v)}
                  style={{ width: 120 }} allowClear
                  options={FIELDS.map(f => ({ value: f.value, label: f.label }))} />
                <Select placeholder="条件" value={cond.operator || undefined}
                  onChange={v => updateCond(group, cond.id, 'operator', v)}
                  style={{ width: 130 }} options={OPERATORS} />
                {needsDays && <InputNumber placeholder="天数" value={cond.days}
                  onChange={v => updateCond(group, cond.id, 'days', v)} style={{ width: 90 }} min={1} addonAfter="天" />}
                {needsDate && <Input placeholder="日期，如 2024-01-01" value={cond.value}
                  onChange={e => updateCond(group, cond.id, 'value', e.target.value)} style={{ width: 170 }} />}
                {needsKeywords && <Input placeholder="关键词，逗号分隔" value={cond.value}
                  onChange={e => updateCond(group, cond.id, 'value', e.target.value)} style={{ width: 200 }} />}
                {!noValue && !needsDays && !needsDate && !needsKeywords && (
                  <Input placeholder="值" value={cond.value}
                    onChange={e => updateCond(group, cond.id, 'value', e.target.value)} style={{ width: 150 }} />)}
                {totalInGroup > 1 && (
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeCond(group, cond.id)} />
                )}
              </div>
            );
          })}
          {group.groups.map(g => renderGroup(g, depth + 1, group))}
          <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => addCond(group)}>
            添加条件
          </Button>
        </Space>
      </Card>
    );
  }

  return (
    <Modal title={editingRule ? '编辑规则' : '创建规则'} open={open} onCancel={onClose} footer={null} width={720} destroyOnClose>
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item name="name" label="规则名称" rules={[{ required: true, message: '请输入' }]}>
          <Input placeholder="例如：检测未启用 MFA 的管理员" />
        </Form.Item>
        <Form.Item name="severity" label="严重度" rules={[{ required: true, message: '请选择' }]}>
          <Select options={[{ value: 'HIGH', label: '🟠 高' }, { value: 'MEDIUM', label: '🟡 中' }, { value: 'LOW', label: '🟢 低' }]} />
        </Form.Item>
        <Form.Item name="description" label="规则描述" rules={[{ required: true, message: '请输入' }]}>
          <Input.TextArea rows={2} placeholder="描述检测逻辑和目的" />
        </Form.Item>
        <Divider style={{ margin: '12px 0' }} />
        <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 10 }}>检测条件</Text>
        {renderGroup(root, 0)}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={loading} onClick={handleSubmit}>
            {editingRule ? '保存修改' : '创建规则'}
          </Button>
        </div>
      </Form>
    </Modal>
  );
}

// ---- 工具函数 ----
function buildLeaf(c: CondItem): any {
  if (c.operator === 'lt_days') {
    const days = c.days || 180;
    return { field: c.field, operator: c.operator, value: days };
  }
  if (c.operator === 'contains_any') {
    const keywords = (c.value || '').split(',').map(k => k.trim()).filter(Boolean);
    return { field: c.field, operator: c.operator, value: keywords };
  }
  if (c.operator === 'lt_date') {
    return { field: c.field, operator: c.operator, value: c.value };
  }
  if (c.operator === 'not_true' || c.operator === 'is_null' || c.operator === 'is_not_null') {
    return { field: c.field, operator: c.operator };
  }
  return { field: c.field, operator: c.operator, value: c.value };
}

function parseLeaf(c: CondItem): CondItem {
  return {
    id: c.id || cid(),
    field: c.field || '',
    operator: c.operator || '',
    value: c.value ?? '',
    days: typeof (c as any).days === 'number' ? (c as any).days : undefined,
  };
}
