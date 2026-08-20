import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, DatePicker, Descriptions, Form, Input, InputNumber,
  List, message, Modal, Radio, Select, Space, Tabs, Tag, Typography,
} from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import apiClient from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { getApiErrorMessage } from '../../utils/error';
import { conclusionLabels, platformOptions, StatusTag } from './labels';
import { LookupSelect, SearchableSelect } from '../../components/lookups';

type EditorKind = 'permission' | 'dataItem' | 'activity';

function questionControl(question: any, value: any, onChange: (value: any) => void, disabled: boolean) {
  const options = (question.options || []).map((option: any) => typeof option === 'object' ? option : ({ label: String(option), value: option }));
  if (question.questionType === 'boolean') return <Radio.Group disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} options={[{ value: true, label: '是' }, { value: false, label: '否' }]} />;
  if (question.questionType === 'single_select') return options.length > 8
    ? <SearchableSelect disabled={disabled} value={value} onChange={onChange} options={options} style={{ width: '100%' }} />
    : <Select disabled={disabled} value={value} onChange={onChange} options={options} style={{ width: '100%' }} />;
  if (question.questionType === 'multi_select') return options.length > 8
    ? <SearchableSelect mode="multiple" disabled={disabled} value={value || []} onChange={onChange} options={options} style={{ width: '100%' }} />
    : <Select mode="multiple" disabled={disabled} value={value || []} onChange={onChange} options={options} style={{ width: '100%' }} />;
  if (question.questionType === 'number') return <InputNumber disabled={disabled} value={value} onChange={onChange} style={{ width: '100%' }} />;
  if (question.questionType === 'date') return <DatePicker disabled={disabled} value={value ? dayjs(value) : null} onChange={(date) => onChange(date?.format('YYYY-MM-DD') || null)} />;
  return <Input.TextArea disabled={disabled} rows={question.questionType === 'long_text' ? 4 : 2} value={value || ''} onChange={(event) => onChange(event.target.value)} />;
}

export default function DossierDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const can = useAuthStore((state) => state.hasPermission);
  const [dossier, setDossier] = useState<any>();
  const [diff, setDiff] = useState<any>();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [permissions, setPermissions] = useState<any[]>([]);
  const [dataItems, setDataItems] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [editor, setEditor] = useState<{ kind: EditorKind; index: number } | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [questionnaireOpen, setQuestionnaireOpen] = useState(false);
  const [entityForm] = Form.useForm();
  const [overviewForm] = Form.useForm();
  const [reviewForm] = Form.useForm();
  const [questionnaireForm] = Form.useForm();

  const mutable = dossier && ['draft', 'changes_requested'].includes(dossier.lifecycleStatus) && can('product_dossiers', 'update');
  const load = async () => {
    try {
      const [response, diffResponse]: any[] = await Promise.all([
        apiClient.get(`/product-compliance/dossiers/${id}`),
        apiClient.get(`/product-compliance/dossiers/${id}/inheritance-diff`),
      ]);
      const next = response.data;
      setDossier(next); setDiff(diffResponse.data);
      setAnswers(Object.fromEntries((next.questionnaires || []).flatMap((item: any) => (item.answers || []).map((answer: any) => [answer.questionId, answer.response]))));
      const data = (next.dataItems || []).map((item: any, index: number) => ({ ...item, clientId: item.id || `data-${index}` }));
      setDataItems(data);
      setPermissions((next.platformPermissions || []).map((item: any) => ({ ...item, dataItemIds: (item.dataItems || []).map((dataItem: any) => dataItem.id) })));
      setActivities((next.processingActivities || []).map((item: any) => ({ ...item, dataItemIds: (item.dataItems || []).map((dataItem: any) => dataItem.id) })));
      overviewForm.setFieldsValue({ proposedConclusion: next.proposedConclusion, reviewerId: next.reviewerId });
    } catch (error) { message.error(getApiErrorMessage(error, '加载合规档案失败')); }
  };
  useEffect(() => { load(); }, [id]);

  const headers = useMemo(() => ({ 'If-Match': String(dossier?.lockVersion ?? '') }), [dossier?.lockVersion]);
  const saveOverview = async () => {
    try { await apiClient.put(`/product-compliance/dossiers/${id}/overview`, overviewForm.getFieldsValue(), { headers }); message.success('档案概览已保存'); load(); }
    catch (error) { message.error(getApiErrorMessage(error, '保存失败')); }
  };
  const saveAnswers = async () => {
    try { await apiClient.put(`/product-compliance/dossiers/${id}/answers`, { answers: Object.entries(answers).map(([questionId, response]) => ({ questionId, response })) }, { headers }); message.success('问卷已保存'); load(); }
    catch (error) { message.error(getApiErrorMessage(error, '保存问卷失败')); }
  };
  const saveInventory = async (patch?: any) => {
    try {
      const declaration = patch || { permissionsDeclared: dossier.permissionsDeclared, personalDataDeclared: dossier.personalDataDeclared };
      await apiClient.put(`/product-compliance/dossiers/${id}/inventory`, {
        ...declaration,
        permissions: declaration.permissionsDeclared === false ? [] : permissions,
        dataItems: declaration.personalDataDeclared === false ? [] : dataItems,
        activities: declaration.personalDataDeclared === false ? [] : activities,
      }, { headers });
      message.success('合规清单与ROPA已保存'); load();
    } catch (error) { message.error(getApiErrorMessage(error, '保存清单失败')); }
  };

  const openEditor = (kind: EditorKind, index = -1) => {
    const source = kind === 'permission' ? permissions : kind === 'dataItem' ? dataItems : activities;
    const value = index >= 0 ? source[index] : kind === 'dataItem' ? { clientId: `new-${Date.now()}`, dataSubjectCategories: [] } : { dataItemIds: [], dataSubjectCategories: [], recipientCategories: [], transferCountries: [], controllerRole: 'controller' };
    entityForm.setFieldsValue(value); setEditor({ kind, index });
  };
  const saveEntity = async () => {
    if (!editor) return;
    try {
      const value = await entityForm.validateFields();
      const setter = editor.kind === 'permission' ? setPermissions : editor.kind === 'dataItem' ? setDataItems : setActivities;
      const source = editor.kind === 'permission' ? permissions : editor.kind === 'dataItem' ? dataItems : activities;
      setter(editor.index < 0 ? [...source, value] : source.map((item, index) => index === editor.index ? { ...item, ...value } : item));
      setEditor(null); entityForm.resetFields();
    } catch {}
  };
  const removeEntity = (kind: EditorKind, index: number) => {
    if (kind === 'permission') setPermissions((items) => items.filter((_, i) => i !== index));
    if (kind === 'dataItem') {
      const clientId = dataItems[index].clientId;
      setDataItems((items) => items.filter((_, i) => i !== index));
      setPermissions((items) => items.map((item) => ({ ...item, dataItemIds: (item.dataItemIds || []).filter((value: string) => value !== clientId) })));
      setActivities((items) => items.map((item) => ({ ...item, dataItemIds: (item.dataItemIds || []).filter((value: string) => value !== clientId) })));
    }
    if (kind === 'activity') setActivities((items) => items.filter((_, i) => i !== index));
  };

  const submit = async () => {
    try { await apiClient.post(`/product-compliance/dossiers/${id}/submit`, {}, { headers }); message.success('档案已提交复核'); load(); }
    catch (error: any) {
      const details = error?.error?.details?.errors;
      if (Array.isArray(details)) Modal.warning({ title: '档案尚未完整', content: <List size="small" dataSource={details} renderItem={(item) => <List.Item>{item}</List.Item>} /> });
      else message.error(getApiErrorMessage(error, '提交失败'));
    }
  };
  const returnForChanges = async () => {
    try { const values = await reviewForm.validateFields(); await apiClient.post(`/product-compliance/dossiers/${id}/return`, { reason: values.reason }, { headers }); message.success('档案已退回'); setReturnOpen(false); load(); }
    catch (error: any) { if (!error?.errorFields) message.error(getApiErrorMessage(error, '退回失败')); }
  };
  const confirm = async () => {
    try { const values = await reviewForm.validateFields(); await apiClient.post(`/product-compliance/dossiers/${id}/confirm`, { conclusion: values.conclusion }, { headers }); message.success('档案已确认并锁定'); setConfirmOpen(false); load(); }
    catch (error: any) { if (!error?.errorFields) message.error(getApiErrorMessage(error, '确认失败')); }
  };
  const revise = async () => {
    try { const response: any = await apiClient.post(`/product-compliance/dossiers/${id}/revisions`); message.success('修订草稿已创建'); navigate(`/product-compliance/dossiers/${response.data.id}`); }
    catch (error) { message.error(getApiErrorMessage(error, '创建修订失败')); }
  };
  const openQuestionnaires = () => {
    questionnaireForm.setFieldsValue({ templateIds: (dossier.questionnaires || []).map((item: any) => item.templateId), reason: undefined });
    setQuestionnaireOpen(true);
  };
  const saveQuestionnaires = async () => {
    try {
      const values = await questionnaireForm.validateFields();
      await apiClient.put(`/product-compliance/dossiers/${id}/questionnaires`, values, { headers });
      message.success('适用问卷组合已调整'); setQuestionnaireOpen(false); load();
    } catch (error: any) { if (!error?.errorFields) message.error(getApiErrorMessage(error, '调整问卷失败')); }
  };
  if (!dossier) return null;
  const version = dossier.productVersion;
  const releaseOverdue = version.plannedReleaseDate && dayjs(version.plannedReleaseDate).isBefore(dayjs(), 'day') && dossier.lifecycleStatus !== 'confirmed';

  const listSection = (kind: EditorKind, items: any[], title: string, description: (item: any) => string) => <Card size="small" title={title} extra={mutable ? <Button icon={<PlusOutlined />} onClick={() => openEditor(kind)}>新增</Button> : null}>
    <List dataSource={items} locale={{ emptyText: '暂无记录' }} renderItem={(item, index) => <List.Item actions={mutable ? [<Button key="edit" type="link" icon={<EditOutlined />} onClick={() => openEditor(kind, index)}>编辑</Button>, <Button key="delete" danger type="link" icon={<DeleteOutlined />} onClick={() => removeEntity(kind, index)}>删除</Button>] : []}><List.Item.Meta title={item.name || item.permissionName} description={description(item)} /></List.Item>} />
  </Card>;

  const overview = <Space direction="vertical" size={16} style={{ width: '100%' }}>
    {releaseOverdue ? <Alert type="warning" showIcon message="计划上线日期已到，但本版本档案尚未确认" /> : null}
    {dossier.returnReason ? <Alert type="warning" showIcon message="复核退回原因" description={dossier.returnReason} /> : null}
    <Descriptions bordered column={2} items={[
      { key: 'product', label: '产品', children: version.product?.name }, { key: 'version', label: '版本', children: version.version },
      { key: 'platforms', label: '适用平台', children: version.platforms?.map((item: string) => <Tag key={item}>{item}</Tag>) },
      { key: 'revision', label: '档案修订', children: `R${dossier.revisionNumber}` },
      { key: 'status', label: '流程状态', children: <StatusTag value={dossier.lifecycleStatus} /> },
      { key: 'conclusion', label: '确认结论', children: <StatusTag conclusion value={dossier.complianceConclusion} /> },
      { key: 'scope', label: '使用范围', children: version.usageScope, span: 2 },
      { key: 'change', label: '变更声明', children: version.changeDeclaration?.summary || '—', span: 2 },
    ]} />
    {dossier.sourceDossierId ? <Alert type="info" showIcon message={`本档案继承自历史档案：${diff?.answers?.inherited || 0} 个答案已继承，${diff?.answers?.modified || 0} 个答案已修改，${diff?.answers?.new || 0} 个答案待确认`} /> : null}
    <Card size="small" title="拟定结论"><Form form={overviewForm} layout="inline"><Form.Item name="proposedConclusion" label="拟定合规结论" rules={[{ required: true }]}><Select disabled={!mutable} style={{ width: 180 }} options={Object.entries(conclusionLabels).map(([value, option]) => ({ value, label: option.label }))} /></Form.Item>{mutable ? <Button type="primary" onClick={saveOverview}>保存概览</Button> : null}</Form></Card>
  </Space>;

  const questionnaire = <Space direction="vertical" size={16} style={{ width: '100%' }}>
    {mutable ? <Space style={{ width: '100%', justifyContent: 'flex-end' }}><Button onClick={openQuestionnaires}>调整适用问卷</Button></Space> : null}
    {(dossier.questionnaires || []).length === 0 ? <Alert type="warning" message="当前产品类型尚未配置适用问卷" /> : null}
    {(dossier.questionnaires || []).map((assignment: any) => <Card key={assignment.id} title={`${assignment.templateSnapshot?.name || assignment.template?.name} ${assignment.templateSnapshot?.version || ''}`} extra={<Tag>{assignment.assignmentSource === 'rule' ? '规则匹配' : '人工添加'}</Tag>}>
      {(assignment.answers || []).sort((a: any, b: any) => (a.question?.sortOrder || 0) - (b.question?.sortOrder || 0)).map((answer: any) => <div key={answer.id} style={{ marginBottom: 20 }}>
        <Space><Typography.Text strong>{answer.question?.title}</Typography.Text>{answer.question?.required ? <Tag color="red">必填</Tag> : null}{answer.inheritanceStatus === 'inherited' ? <Tag color="blue">已继承</Tag> : answer.inheritanceStatus === 'modified' ? <Tag color="orange">已修改</Tag> : null}</Space>
        {answer.question?.description ? <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>{answer.question.description}</Typography.Paragraph> : null}
        {questionControl(answer.question, answers[answer.questionId], (value) => setAnswers((current) => ({ ...current, [answer.questionId]: value })), !mutable)}
      </div>)}
    </Card>)}
    {mutable && dossier.questionnaires?.length ? <Button type="primary" onClick={saveAnswers}>保存问卷</Button> : null}
  </Space>;

  const inventory = <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Card size="small"><Space direction="vertical" size={12}><Space><Typography.Text strong>是否申请平台权限</Typography.Text><Radio.Group disabled={!mutable} value={dossier.permissionsDeclared} onChange={(event) => saveInventory({ permissionsDeclared: event.target.value, personalDataDeclared: dossier.personalDataDeclared })} options={[{ value: true, label: '是，维护权限清单' }, { value: false, label: '否，明确不申请' }]} /></Space><Space><Typography.Text strong>是否处理个人数据</Typography.Text><Radio.Group disabled={!mutable} value={dossier.personalDataDeclared} onChange={(event) => saveInventory({ permissionsDeclared: dossier.permissionsDeclared, personalDataDeclared: event.target.value })} options={[{ value: true, label: '是，维护信息类型与ROPA' }, { value: false, label: '否，明确不处理' }]} /></Space></Space></Card>
    {dossier.permissionsDeclared !== false ? listSection('permission', permissions, '平台权限', (item) => `${item.platform} · ${item.purpose} · ${item.required ? '必要' : '可选'}`) : null}
    {dossier.personalDataDeclared !== false ? listSection('dataItem', dataItems, '信息类型清单', (item) => `${item.category} · ${item.sensitive ? '敏感信息' : '一般信息'} · ${item.source || '来源未说明'}`) : null}
    {dossier.personalDataDeclared !== false ? listSection('activity', activities, 'ROPA处理活动', (item) => `${item.purpose} · ${item.legalBasis} · 保存期限：${item.retentionPeriod}`) : null}
    {mutable ? <Button type="primary" onClick={() => saveInventory()}>保存权限、信息类型与ROPA</Button> : null}
  </Space>;

  return <div>
    <Space style={{ marginBottom: 16 }}><Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/product-compliance/products/${version.productId}`)}>返回产品</Button></Space>
    <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
      <div><Typography.Title level={3} style={{ margin: 0 }}>{version.product?.name} · {version.version}</Typography.Title><Space><StatusTag value={dossier.lifecycleStatus} /><StatusTag conclusion value={dossier.complianceConclusion} /></Space></div>
      <Space>{mutable && can('product_dossiers', 'submit') ? <Button type="primary" onClick={submit}>提交复核</Button> : null}{dossier.lifecycleStatus === 'pending_review' && can('product_dossiers', 'review') ? <Button onClick={() => { reviewForm.resetFields(); setReturnOpen(true); }}>退回修改</Button> : null}{dossier.lifecycleStatus === 'pending_review' && can('product_dossiers', 'confirm') ? <Button type="primary" onClick={() => { reviewForm.setFieldsValue({ conclusion: dossier.proposedConclusion === 'not_assessed' ? undefined : dossier.proposedConclusion }); setConfirmOpen(true); }}>确认档案</Button> : null}{dossier.lifecycleStatus === 'confirmed' && can('product_dossiers', 'revise') ? <Button onClick={revise}>创建修订</Button> : null}</Space>
    </Space>
    <Tabs items={[{ key: 'overview', label: '概览', children: overview }, { key: 'questionnaire', label: '产品问卷', children: questionnaire }, { key: 'permissions', label: '权限、信息与ROPA', children: inventory }, { key: 'history', label: '复核记录', children: <Descriptions bordered column={1} items={[{ key: 'submitted', label: '提交时间', children: dossier.submittedAt ? dayjs(dossier.submittedAt).format('YYYY-MM-DD HH:mm') : '—' }, { key: 'confirmed', label: '确认时间', children: dossier.confirmedAt ? dayjs(dossier.confirmedAt).format('YYYY-MM-DD HH:mm') : '—' }, { key: 'source', label: '继承来源', children: dossier.sourceDossierId || '首次建档' }, { key: 'supersedes', label: '修订对象', children: dossier.supersedesDossierId || '—' }]} /> }]} />

    <Modal title={editor?.kind === 'permission' ? '平台权限' : editor?.kind === 'dataItem' ? '信息类型' : 'ROPA处理活动'} open={Boolean(editor)} onCancel={() => setEditor(null)} onOk={saveEntity} width={680} destroyOnHidden>
      <Form form={entityForm} layout="vertical" preserve={false}>
        {editor?.kind === 'permission' ? <><Form.Item name="platform" label="平台" rules={[{ required: true }]}><Select options={platformOptions} /></Form.Item><Form.Item name="permissionName" label="权限名称" rules={[{ required: true }]}><Input placeholder="例如 android.permission.CAMERA" /></Form.Item><Form.Item name="purpose" label="用途" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item><Form.Item name="required" valuePropName="checked"><Checkbox>属于产品必要权限</Checkbox></Form.Item><Form.Item name="dataItemIds" label="关联信息类型"><SearchableSelect mode="multiple" options={dataItems.map((item) => ({ value: item.clientId, label: item.name }))} /></Form.Item></> : null}
        {editor?.kind === 'dataItem' ? <><Form.Item name="clientId" hidden><Input /></Form.Item><Form.Item name="name" label="信息名称" rules={[{ required: true }]}><Input placeholder="例如 手机号" /></Form.Item><Form.Item name="category" label="数据类别" rules={[{ required: true }]}><Input placeholder="例如 联系信息" /></Form.Item><Form.Item name="dataSubjectCategories" label="数据主体类别"><Select mode="tags" /></Form.Item><Form.Item name="source" label="信息来源"><Input /></Form.Item><Space><Form.Item name="sensitive" valuePropName="checked"><Checkbox>敏感信息</Checkbox></Form.Item><Form.Item name="required" valuePropName="checked"><Checkbox>产品必要信息</Checkbox></Form.Item></Space><Form.Item name="notes" label="备注"><Input.TextArea /></Form.Item></> : null}
        {editor?.kind === 'activity' ? <><Form.Item name="name" label="活动名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="purpose" label="处理目的" rules={[{ required: true }]}><Input.TextArea /></Form.Item><Form.Item name="legalBasis" label="法律依据" rules={[{ required: true }]}><Select options={['同意', '合同必要', '法律义务', '重大利益', '公共任务', '合法利益'].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="controllerRole" label="责任角色" rules={[{ required: true }]}><Select options={[{ value: 'controller', label: '控制者' }, { value: 'processor', label: '处理者' }, { value: 'joint_controller', label: '共同控制者' }]} /></Form.Item><Form.Item name="dataItemIds" label="关联信息类型" rules={[{ required: true }]}><SearchableSelect mode="multiple" options={dataItems.map((item) => ({ value: item.clientId, label: item.name }))} /></Form.Item><Form.Item name="dataSubjectCategories" label="数据主体类别"><Select mode="tags" /></Form.Item><Form.Item name="recipientCategories" label="接收方类别"><Select mode="tags" /></Form.Item><Form.Item name="internationalTransfer" valuePropName="checked"><Checkbox>涉及跨境传输</Checkbox></Form.Item><Form.Item name="transferCountries" label="传输国家/地区"><Select mode="tags" /></Form.Item><Form.Item name="transferSafeguards" label="跨境保障措施"><Input.TextArea /></Form.Item><Form.Item name="retentionPeriod" label="删除或保存期限" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="securityMeasures" label="技术与组织安全措施" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item><Form.Item name="responsibleParty" label="责任主体" rules={[{ required: true }]}><Input /></Form.Item></> : null}
      </Form>
    </Modal>
    <Modal title="退回档案" open={returnOpen} onCancel={() => setReturnOpen(false)} onOk={returnForChanges}><Form form={reviewForm} layout="vertical"><Form.Item name="reason" label="退回原因" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item></Form></Modal>
    <Modal title="确认合规档案" open={confirmOpen} onCancel={() => setConfirmOpen(false)} onOk={confirm}><Alert type="warning" showIcon message="确认后档案将锁定，后续纠错必须创建新修订。" style={{ marginBottom: 16 }} /><Form form={reviewForm} layout="vertical"><Form.Item name="conclusion" label="最终合规结论" rules={[{ required: true }]}><Select options={Object.entries(conclusionLabels).filter(([value]) => value !== 'not_assessed').map(([value, option]) => ({ value, label: option.label }))} /></Form.Item></Form></Modal>
    <Modal title="调整适用问卷" open={questionnaireOpen} onCancel={() => setQuestionnaireOpen(false)} onOk={saveQuestionnaires}><Alert type="warning" showIcon message="新增问卷将生成待填写问题；移除问卷不会改变已确认的历史档案。" style={{ marginBottom: 16 }} /><Form form={questionnaireForm} layout="vertical"><Form.Item name="templateIds" label="适用问卷"><LookupSelect kind="product-questionnaires" purpose="product-questionnaire" contextId={id} mode="multiple" /></Form.Item><Form.Item name="reason" label="调整原因" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item></Form></Modal>
  </div>;
}
