import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, DatePicker, Form, Input, Select, Space, Spin, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { riskApi } from '../api/risks';
import { DepartmentSelect, LookupSelect, PersonnelSelect } from '../components/lookups';
import { RISK_DISCOVERY_SOURCE, RISK_LEVEL, TREATMENT_STRATEGY } from '../constants/status';
import { getApiErrorMessage } from '../utils/error';
import { useAuthStore } from '../store/auth';

const sourceOptions = Object.entries(RISK_DISCOVERY_SOURCE)
  .filter(([value]) => value !== 'compliance_assessment')
  .map(([value, label]) => ({ value, label }));

export default function RiskForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [reviewerForm] = Form.useForm();
  const [risk, setRisk] = useState<any>();
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignmentError, setAssignmentError] = useState('');
  const [loadError, setLoadError] = useState('');
  const idempotencyKey = useRef(crypto.randomUUID());
  const canAssign = useAuthStore((state) => state.hasPermission)('risks', 'assign');
  const manual = !editing || risk?.creationMode === 'manual';

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    setLoadError('');
    riskApi.detail(id).then((response: any) => {
      if (!active) return;
      const current = response.data;
      if (current.status !== 'pending_confirmation') throw new Error('只有待确认风险可以编辑');
      setRisk(current);
      reviewerForm.setFieldsValue({ reviewerUserId: current.reviewerUserId });
      form.setFieldsValue({
        ...current,
        dueDate: current.dueDate ? dayjs(current.dueDate) : null,
        assets: (current.affectedAssets || []).map((item: any) => ({
          assetId: item.assetId, impactLevel: item.impactLevel, impactDescription: item.impactDescription,
        })),
      });
    }).catch((error) => { if (active) setLoadError(getApiErrorMessage(error, '风险加载失败')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, form, reviewerForm]);

  const submit = async (values: any) => {
    if (saving || assigning) return;
    setSaving(true);
    const payload: any = {
      title: values.title,
      description: values.description,
      riskLevel: values.riskLevel,
      treatmentStrategy: values.treatmentStrategy,
      ownerDepartmentId: values.ownerDepartmentId,
      ownerUserId: values.ownerUserId,
      dueDate: values.dueDate?.format('YYYY-MM-DD') || null,
      assets: values.assets.map((asset: any) => ({ ...asset, impactLevel: asset.impactLevel || null,
        impactDescription: asset.impactDescription?.trim() || null })),
      ...(manual ? {
        discoverySource: values.discoverySource,
        discoverySourceDetail: values.discoverySourceDetail,
        sourceReference: values.sourceReference,
      } : {}),
      ...(!editing ? { reviewerUserId: values.reviewerUserId } : {}),
    };
    try {
      const response: any = editing
        ? await riskApi.update(id!, payload, risk.lockVersion)
        : await riskApi.create(payload, idempotencyKey.current);
      setRisk(response.data);
      message.success(editing ? '风险已更新' : '风险已创建');
      navigate(`/risks/${response.data.id}`);
    } catch (error: any) {
      if (error?.error?.code === 'CONFLICT') {
        message.error(getApiErrorMessage(error, '风险已被其他人修改，请刷新后重试'));
      } else message.error(getApiErrorMessage(error, editing ? '更新失败，表单内容已保留' : '创建失败，表单内容已保留'));
    } finally { setSaving(false); }
  };

  const assignReviewer = async ({ reviewerUserId }: { reviewerUserId: string }) => {
    if (!editing || !manual || !canAssign || saving || assigning) return;
    if (reviewerUserId === risk.reviewerUserId) { message.info('审核人未变更'); return; }
    setAssigning(true);
    setAssignmentError('');
    try {
      const response: any = await riskApi.assignReviewer(id!, reviewerUserId, risk.lockVersion);
      // Keep the latest concurrency token without replacing unsaved risk form fields.
      setRisk(response.data);
      reviewerForm.setFieldsValue({ reviewerUserId: response.data.reviewerUserId });
      message.success('审核人已分配，未保存的风险资料保持不变');
    } catch (error: any) {
      setAssignmentError(getApiErrorMessage(error, error?.error?.code === 'CONFLICT'
        ? '风险已被其他人修改，请刷新后重试' : '分配失败，请修正后重试'));
    } finally { setAssigning(false); }
  };

  if (loading) return <div style={{ padding: 64, textAlign: 'center' }}><Spin /></div>;
  if (loadError) return <Alert type="error" showIcon message={loadError} />;
  return (
    <div style={{ maxWidth: 920, margin: '0 auto' }}>
      <Typography.Title level={3}>{editing ? '编辑风险' : '新增独立风险'}</Typography.Title>
      <Typography.Paragraph type="secondary">{manual
        ? '独立风险不属于评估项目，由指定审核人负责确认与整改验证。'
        : '评估风险的来源由评估关系确定，可修改风险资料和受影响资产。'}</Typography.Paragraph>
      <Form form={form} layout="vertical" disabled={saving || assigning} onFinish={submit} initialValues={{
        discoverySource: 'daily_operations', riskLevel: 'medium', treatmentStrategy: 'mitigate', assets: [{}],
      }}>
        <Card title="基本信息" style={{ marginBottom: 16 }}>
          <Form.Item name="title" label="标题" rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
          <Form.Item name="description" label="描述" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={4} /></Form.Item>
          <Space align="start" wrap>
            <Form.Item name="riskLevel" label="风险等级" rules={[{ required: true }]}><Select style={{ width: 180 }} options={Object.entries(RISK_LEVEL).map(([value, item]) => ({ value, label: item.text }))} /></Form.Item>
            <Form.Item name="treatmentStrategy" label="处置策略" rules={[{ required: true }]}><Select style={{ width: 180 }} options={Object.entries(TREATMENT_STRATEGY).map(([value, label]) => ({ value, label }))} /></Form.Item>
            <Form.Item name="dueDate" label="处置期限"><DatePicker /></Form.Item>
          </Space>
        </Card>
        {manual ? <Card title="发现来源" style={{ marginBottom: 16 }}>
          <Form.Item name="discoverySource" label="发现来源" rules={[{ required: true }]}><Select options={sourceOptions} /></Form.Item>
          <Form.Item name="discoverySourceDetail" label="来源说明" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} placeholder="说明在日常运维中如何发现该风险" /></Form.Item>
          <Form.Item name="sourceReference" label="来源引用"><Input maxLength={300} placeholder="工单号、事件号或外部引用（可选）" /></Form.Item>
        </Card> : <Card title="发现来源" style={{ marginBottom: 16 }}>
          <Typography.Text>{RISK_DISCOVERY_SOURCE[risk.discoverySource] || '合规评估'}（只读）</Typography.Text>
        </Card>}
        <Card title="责任与审核" style={{ marginBottom: 16 }}>
          <Space align="start" wrap>
            <Form.Item name="ownerDepartmentId" label="责任部门" rules={[{ required: true }]} style={{ width: 280 }}><DepartmentSelect purpose="risk-owner" contextId={id} /></Form.Item>
            <Form.Item name="ownerUserId" label="负责人" rules={[{ required: true }]} style={{ width: 280 }}><PersonnelSelect purpose="risk-owner" contextId={id} /></Form.Item>
            {!editing && <Form.Item name="reviewerUserId" label="审核人" rules={[{ required: true }]} style={{ width: 280 }}><PersonnelSelect purpose="risk-reviewer" placeholder="输入具备确认/验证权限的人员姓名" /></Form.Item>}
          </Space>
        </Card>
        <Card title="受影响资产" style={{ marginBottom: 16 }}>
          <Form.List name="assets" rules={[{ validator: async (_, list) => { if (!list?.length) throw new Error('至少添加一个受影响资产'); } }]}>
            {(fields, { add, remove }, { errors }) => <>
              {fields.map(({ key, name }) => <Space key={key} align="start" style={{ display: 'flex', marginBottom: 8 }} wrap>
                <Form.Item name={[name, 'assetId']} rules={[{ required: true, message: '请选择资产' }]}><LookupSelect aria-label="受影响资产" kind="assets" purpose="risk-assets" contextId={id} style={{ width: 280 }} placeholder="输入资产名称检索" /></Form.Item>
                <Form.Item name={[name, 'impactLevel']}><Select aria-label="资产影响等级" allowClear style={{ width: 140 }} placeholder="影响等级" options={Object.entries(RISK_LEVEL).map(([value, item]) => ({ value, label: item.text }))} /></Form.Item>
                <Form.Item name={[name, 'impactDescription']}><Input style={{ width: 300 }} placeholder="影响说明（可选）" /></Form.Item>
                {fields.length > 1 && <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(name)} />}
              </Space>)}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add()} block>添加资产</Button><Form.ErrorList errors={errors} />
            </>}
          </Form.List>
        </Card>
        <Space><Button type="primary" htmlType="submit" loading={saving}>{editing ? '保存修改' : '创建风险'}</Button><Button onClick={() => navigate(editing ? `/risks/${id}` : '/governance')}>取消</Button></Space>
      </Form>
      {editing && manual && <Card title="独立审核人" style={{ marginTop: 16 }}>
        <Typography.Paragraph>当前审核人：{risk.reviewer?.displayName || '—'}</Typography.Paragraph>
        {canAssign && <Form form={reviewerForm} name="risk-reviewer-assignment" layout="vertical"
          disabled={saving || assigning} onFinish={assignReviewer}>
          <Typography.Paragraph type="secondary">分配审核人单独保存，不会提交上方尚未保存的风险资料。</Typography.Paragraph>
          {assignmentError && <Alert type="error" showIcon message={assignmentError} style={{ marginBottom: 16 }} />}
          <Form.Item name="reviewerUserId" label="审核人" rules={[{ required: true, message: '请选择审核人' },
            { validator: async (_, value) => {
              if (value && [risk.createdBy, risk.ownerUserId].includes(value)) throw new Error('审核人不能是创建人或当前负责人');
            } }]}>
            <PersonnelSelect purpose="risk-reviewer" contextId={id} placeholder="输入具备确认/验证权限的人员姓名" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={assigning}>分配审核人</Button>
        </Form>}
      </Card>}
    </div>
  );
}
