import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Breadcrumb, Button, Card, Checkbox, ConfigProvider, DatePicker, Descriptions, Form, Input, InputNumber,
  List, message, Modal, Radio, Result, Select, Space, Spin, Tabs, Tag, Typography,
} from 'antd';
import { ArrowLeftOutlined, CheckCircleFilled, CloseCircleFilled, DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import apiClient from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { getApiErrorMessage } from '../../utils/error';
import { conclusionLabels, platformOptions, StatusTag } from './labels';
import { LookupSelect, SearchableSelect } from '../../components/lookups';

const accessibleTextTheme = { token: { colorTextSecondary: '#636366', colorTextTertiary: '#636366', colorTextDescription: '#636366', colorTextPlaceholder: '#636366' } };

type EditorKind = 'permission' | 'dataItem' | 'activity' | 'thirdPartyService' | 'thirdPartyAssessment';
type SubmissionCheck = { key: string; complete: boolean; text: string };

function answerPresent(response: unknown): boolean {
  if (response === null || response === undefined || response === '') return false;
  return !Array.isArray(response) || response.length > 0;
}

export function buildSubmissionChecklist(dossier: any): SubmissionCheck[] {
  const requiredAnswers = (dossier?.questionnaires || []).flatMap((assignment: any) => assignment.answers || []).filter((answer: any) => answer.question?.required);
  return [
    ...requiredAnswers.map((answer: any) => ({
      key: `question-${answer.questionId}`,
      complete: answerPresent(answer.response),
      text: answerPresent(answer.response) ? `必答题已填写：${answer.question.title}` : `必答题未填写：${answer.question.title}`,
    })),
    { key: 'permissions-declared', complete: dossier?.permissionsDeclared !== null, text: dossier?.permissionsDeclared !== null ? '已明确是否申请平台权限' : '请明确是否申请平台权限' },
    { key: 'permissions', complete: dossier?.permissionsDeclared !== true || Boolean(dossier?.platformPermissions?.length), text: dossier?.permissionsDeclared === true && !dossier?.platformPermissions?.length ? '已声明申请平台权限，请至少填写一项权限' : dossier?.permissionsDeclared === true ? '已填写平台权限明细' : '平台权限明细无需填写' },
    { key: 'personal-data-declared', complete: dossier?.personalDataDeclared !== null, text: dossier?.personalDataDeclared !== null ? '已明确是否处理个人数据' : '请明确是否处理个人数据' },
    { key: 'data-items', complete: dossier?.personalDataDeclared !== true || Boolean(dossier?.dataItems?.length), text: dossier?.personalDataDeclared === true && !dossier?.dataItems?.length ? '已声明处理个人数据，请至少填写一种信息类型' : dossier?.personalDataDeclared === true ? '已填写信息类型' : '信息类型无需填写' },
    { key: 'activities', complete: dossier?.personalDataDeclared !== true || Boolean(dossier?.processingActivities?.length), text: dossier?.personalDataDeclared === true && !dossier?.processingActivities?.length ? '已声明处理个人数据，请至少填写一项ROPA处理活动' : dossier?.personalDataDeclared === true ? '已填写ROPA处理活动' : 'ROPA处理活动无需填写' },
    { key: 'third-party-result', complete: !(dossier?.thirdPartyServices || []).some((service: any) => service.assessmentPassed === null || service.assessmentPassed === undefined), text: (dossier?.thirdPartyServices || []).some((service: any) => service.assessmentPassed === null || service.assessmentPassed === undefined) ? '第三方清单需明确是否通过第三方评审' : '第三方评审结果已明确' },
    { key: 'third-party-assessment', complete: !dossier?.thirdPartyServices?.length || Boolean(dossier?.thirdPartyAssessments?.length), text: dossier?.thirdPartyServices?.length && !dossier?.thirdPartyAssessments?.length ? '已填写第三方清单，请至少保留一份第三方安全评审记录' : '第三方安全评审记录无需补充' },
    { key: 'conclusion', complete: Boolean(dossier?.proposedConclusion && dossier.proposedConclusion !== 'not_assessed'), text: dossier?.proposedConclusion && dossier.proposedConclusion !== 'not_assessed' ? '已填写拟定合规结论' : '请填写拟定合规结论' },
  ];
}

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [diff, setDiff] = useState<any>();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [permissions, setPermissions] = useState<any[]>([]);
  const [dataItems, setDataItems] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [dataCatalog, setDataCatalog] = useState<any[]>([]);
  const [thirdPartyServices, setThirdPartyServices] = useState<any[]>([]);
  const [thirdPartyAssessments, setThirdPartyAssessments] = useState<any[]>([]);
  const [editor, setEditor] = useState<{ kind: EditorKind; index: number } | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [questionnaireOpen, setQuestionnaireOpen] = useState(false);
  const [entityForm] = Form.useForm();
  const [overviewForm] = Form.useForm();
  const [reviewForm] = Form.useForm();
  const [questionnaireForm] = Form.useForm();

  const mutable = dossier && ['draft', 'changes_requested'].includes(dossier.lifecycleStatus) && can('product_dossiers', 'update');
  const loadCatalog = async () => {
    try { const response: any = await apiClient.get('/product-compliance/config/data-catalog'); setDataCatalog(response.data || []); }
    catch { setDataCatalog([]); }
  };
  const load = async () => {
    setLoading(true); setLoadError('');
    try {
      const response: any = await apiClient.get(`/product-compliance/dossiers/${id}`);
      const next = response.data;
      setDossier(next);
      setAnswers(Object.fromEntries((next.questionnaires || []).flatMap((item: any) => (item.answers || []).map((answer: any) => [answer.questionId, answer.response]))));
      const data = (next.dataItems || []).map((item: any, index: number) => ({ ...item, clientId: item.id || `data-${index}` }));
      setDataItems(data);
      setPermissions((next.platformPermissions || []).map((item: any) => ({ ...item, dataItemIds: (item.dataItems || []).map((dataItem: any) => dataItem.id) })));
      setActivities((next.processingActivities || []).map((item: any) => ({ ...item, dataItemIds: (item.dataItems || []).map((dataItem: any) => dataItem.id) })));
      const services = (next.thirdPartyServices || []).map((item: any, index: number) => ({ ...item, clientId: item.id || `third-party-${index}` }));
      setThirdPartyServices(services);
      setThirdPartyAssessments((next.thirdPartyAssessments || []).map((item: any, index: number) => ({ ...item, clientId: item.id || `third-party-assessment-${index}`, serviceClientId: item.serviceId || item.service?.id || null })));
      overviewForm.setFieldsValue({ proposedConclusion: next.proposedConclusion, reviewerId: next.reviewerId });
      try { const diffResponse: any = await apiClient.get(`/product-compliance/dossiers/${id}/inheritance-diff`); setDiff(diffResponse.data); }
      catch { setDiff(undefined); message.warning('继承差异暂时无法加载，不影响查看和填写档案'); }
    } catch (error) { setDossier(undefined); setLoadError(getApiErrorMessage(error, '加载合规档案失败')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [id]);
  useEffect(() => { loadCatalog(); }, []);

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
        thirdPartyServices: declaration.personalDataDeclared === false ? [] : thirdPartyServices,
        thirdPartyAssessments: declaration.personalDataDeclared === false ? [] : thirdPartyAssessments,
      }, { headers });
      message.success('合规清单与ROPA已保存'); load();
    } catch (error) { message.error(getApiErrorMessage(error, '保存清单失败')); }
  };

  const openEditor = (kind: EditorKind, index = -1) => {
    const source = kind === 'permission' ? permissions : kind === 'dataItem' ? dataItems : kind === 'activity' ? activities : kind === 'thirdPartyService' ? thirdPartyServices : thirdPartyAssessments;
    const value = index >= 0 ? source[index]
      : kind === 'dataItem' ? { clientId: `data-${Date.now()}`, dataSubjectCategories: [], operatingSystems: [] }
        : kind === 'activity' ? { dataItemIds: [], dataSubjectCategories: [], recipientCategories: [], transferCountries: [], controllerRole: 'controller' }
          : kind === 'thirdPartyService' ? { clientId: `third-party-${Date.now()}`, sharedFields: [], assessmentPassed: null }
            : { clientId: `third-party-assessment-${Date.now()}`, title: '第三方信息安全和隐私合规自检表', answers: [] };
    entityForm.setFieldsValue(value); setEditor({ kind, index });
  };
  const saveEntity = async () => {
    if (!editor) return;
    try {
      const value = await entityForm.validateFields();
      const setter = editor.kind === 'permission' ? setPermissions : editor.kind === 'dataItem' ? setDataItems : editor.kind === 'activity' ? setActivities : editor.kind === 'thirdPartyService' ? setThirdPartyServices : setThirdPartyAssessments;
      const source = editor.kind === 'permission' ? permissions : editor.kind === 'dataItem' ? dataItems : editor.kind === 'activity' ? activities : editor.kind === 'thirdPartyService' ? thirdPartyServices : thirdPartyAssessments;
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
    if (kind === 'thirdPartyService') {
      const clientId = thirdPartyServices[index].clientId;
      setThirdPartyServices((items) => items.filter((_, i) => i !== index));
      setThirdPartyAssessments((items) => items.map((item) => item.serviceClientId === clientId ? { ...item, serviceClientId: null } : item));
    }
    if (kind === 'thirdPartyAssessment') setThirdPartyAssessments((items) => items.filter((_, i) => i !== index));
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
  const applyCatalogItem = (catalogItemId: string) => {
    const item = dataCatalog.find((candidate) => candidate.id === catalogItemId);
    if (!item) return;
    entityForm.setFieldsValue({
      catalogItemId: item.id,
      name: item.name,
      category: item.category,
      dataSubjectCategories: [item.dataSubject],
      sensitive: item.sensitive,
      required: item.required,
    });
  };
  const downloadExport = async () => {
    try {
      const blob = await apiClient.get(`/product-compliance/dossiers/${id}/export.xlsx`, { responseType: 'blob' }) as unknown as Blob;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${dossier?.productVersion?.product?.name || 'product-compliance'}-${dossier?.productVersion?.version || 'dossier'}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { message.error(getApiErrorMessage(error, '导出失败')); }
  };
  const breadcrumb = <Breadcrumb style={{ marginBottom: 16 }} items={[
    { title: <a onClick={() => navigate('/product-compliance/products')}>产品台账</a> },
    ...(dossier?.productVersion?.product ? [{ title: <a onClick={() => navigate(`/product-compliance/products/${dossier.productVersion.productId}`)}>{dossier.productVersion.product.name}</a> }] : []),
    { title: dossier ? `${dossier.productVersion.version} · R${dossier.revisionNumber}` : '合规档案' },
  ]} />;
  if (loading && !dossier) return <ConfigProvider theme={accessibleTextTheme}><div>{breadcrumb}<Card><div style={{ padding: 48, textAlign: 'center' }}><Space direction="vertical"><Spin /><Typography.Text type="secondary">正在加载合规档案...</Typography.Text></Space></div></Card></div></ConfigProvider>;
  if (loadError || !dossier) return <ConfigProvider theme={accessibleTextTheme}><div>{breadcrumb}<Card><Result status="error" title="无法加载合规档案" subTitle={loadError || '档案不存在或已无法访问'} extra={<Space><Button onClick={() => navigate('/product-compliance/products')}>返回产品台账</Button><Button type="primary" onClick={load}>重试</Button></Space>} /></Card></div></ConfigProvider>;
  const version = dossier.productVersion;
  const releaseOverdue = version.plannedReleaseDate && dayjs(version.plannedReleaseDate).isBefore(dayjs(), 'day') && dossier.lifecycleStatus !== 'confirmed';
  const submissionChecklist = buildSubmissionChecklist(dossier);
  const incompleteChecks = submissionChecklist.filter((item) => !item.complete);
  const appQuestionnaires = (dossier.questionnaires || []).filter((assignment: any) => assignment.templateSnapshot?.seriesKey === 'app-compliance-checklist' || assignment.template?.seriesKey === 'app-compliance-checklist');
  const baseQuestionnaires = (dossier.questionnaires || []).filter((assignment: any) => !appQuestionnaires.some((app: any) => app.id === assignment.id));
  const renderQuestionnaireAssignments = (items: any[]) => <Space direction="vertical" size={16} style={{ width: '100%' }}>
    {mutable ? <Space style={{ width: '100%', justifyContent: 'flex-end' }}><Button onClick={openQuestionnaires}>调整适用问卷</Button></Space> : null}
    {items.length === 0 ? <Alert type="warning" message="当前没有匹配的问卷模板" /> : null}
    {items.map((assignment: any) => <Card key={assignment.id} title={`${assignment.templateSnapshot?.name || assignment.template?.name} ${assignment.templateSnapshot?.version || ''}`} extra={<Tag>{assignment.assignmentSource === 'rule' ? '规则匹配' : '人工添加'}</Tag>}>
      {(assignment.answers || []).sort((a: any, b: any) => (a.question?.sortOrder || 0) - (b.question?.sortOrder || 0)).map((answer: any) => <div key={answer.id} style={{ marginBottom: 20 }}>
        <Space><Typography.Text strong>{answer.question?.title}</Typography.Text>{answer.question?.required ? <Tag color="red">必填</Tag> : null}{answer.inheritanceStatus === 'inherited' ? <Tag color="blue">已继承</Tag> : answer.inheritanceStatus === 'modified' ? <Tag color="orange">已修改</Tag> : null}</Space>
        {answer.question?.description ? <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>{answer.question.description}</Typography.Paragraph> : null}
        {questionControl(answer.question, answers[answer.questionId], (value) => setAnswers((current) => ({ ...current, [answer.questionId]: value })), !mutable)}
      </div>)}
    </Card>)}
    {mutable && items.length ? <Button type="primary" onClick={saveAnswers}>保存问卷</Button> : null}
  </Space>;

  const listSection = (kind: EditorKind, items: any[], title: string, description: (item: any) => string) => <Card size="small" title={title} extra={mutable ? <Button icon={<PlusOutlined />} onClick={() => openEditor(kind)}>新增</Button> : null}>
    <List dataSource={items} locale={{ emptyText: '暂无记录' }} renderItem={(item, index) => <List.Item actions={mutable ? [<Button key="edit" type="link" icon={<EditOutlined />} onClick={() => openEditor(kind, index)}>编辑</Button>, <Button key="delete" danger type="link" icon={<DeleteOutlined />} onClick={() => removeEntity(kind, index)}>删除</Button>] : []}><List.Item.Meta title={item.name || item.permissionName || item.serviceName || item.title} description={description(item)} /></List.Item>} />
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

  const declarationControls = <Card size="small"><Space direction="vertical" size={12}><Space><Typography.Text strong>是否申请平台权限</Typography.Text><Radio.Group disabled={!mutable} value={dossier.permissionsDeclared} onChange={(event) => saveInventory({ permissionsDeclared: event.target.value, personalDataDeclared: dossier.personalDataDeclared })} options={[{ value: true, label: '是，维护权限清单' }, { value: false, label: '否，明确不申请' }]} /></Space><Space><Typography.Text strong>是否处理个人数据</Typography.Text><Radio.Group disabled={!mutable} value={dossier.personalDataDeclared} onChange={(event) => saveInventory({ permissionsDeclared: dossier.permissionsDeclared, personalDataDeclared: event.target.value })} options={[{ value: true, label: '是，维护信息类型、ROPA与第三方清单' }, { value: false, label: '否，明确不处理' }]} /></Space></Space></Card>;
  const permissionsAndData = <Space direction="vertical" size={16} style={{ width: '100%' }}>
    {declarationControls}
    {dossier.permissionsDeclared !== false ? listSection('permission', permissions, '权限清单', (item) => `${item.operatingSystem || item.platform} · ${item.purpose} · ${item.required ? '必要' : '可选'}`) : null}
    {dossier.personalDataDeclared !== false ? listSection('dataItem', dataItems, '个人信息清单', (item) => `${item.category} · ${item.sensitive ? '敏感信息' : '一般信息'} · ${item.purpose || item.source || '用途未说明'}`) : null}
    {mutable ? <Button type="primary" onClick={() => saveInventory()}>保存权限与个人信息</Button> : null}
  </Space>;
  const ropa = <Space direction="vertical" size={16} style={{ width: '100%' }}>
    {declarationControls}
    {dossier.personalDataDeclared !== false ? listSection('activity', activities, 'RoPA(数据处理记录)', (item) => `${item.purpose} · ${item.legalBasis} · 留存：${item.retentionPeriod}`) : null}
    {mutable ? <Button type="primary" onClick={() => saveInventory()}>保存ROPA</Button> : null}
  </Space>;
  const thirdPartyInventory = <Space direction="vertical" size={16} style={{ width: '100%' }}>
    {declarationControls}
    {dossier.personalDataDeclared !== false ? listSection('thirdPartyService', thirdPartyServices, '第三方清单', (item) => `${item.thirdPartyName || '第三方名称未填'} · ${item.assessmentPassed === true ? '已通过评审' : item.assessmentPassed === false ? '未通过评审' : '评审结果未明确'}`) : null}
    {mutable ? <Button type="primary" onClick={() => saveInventory()}>保存第三方清单</Button> : null}
  </Space>;
  const thirdPartyReview = <Space direction="vertical" size={16} style={{ width: '100%' }}>
    {dossier.personalDataDeclared !== false ? listSection('thirdPartyAssessment', thirdPartyAssessments, '第三方安全评审', (item) => `${thirdPartyServices.find((service) => service.clientId === item.serviceClientId)?.serviceName || '未关联服务'} · ${item.answers?.length || 0} 个评估项`) : null}
    {mutable ? <Button type="primary" onClick={() => saveInventory()}>保存第三方安全评审</Button> : null}
  </Space>;

  return <ConfigProvider theme={accessibleTextTheme}><div>
    {breadcrumb}
    <Space style={{ marginBottom: 16 }}><Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/product-compliance/products/${version.productId}`)}>返回产品</Button></Space>
    <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
      <div><Typography.Title level={3} style={{ margin: 0 }}>{version.product?.name} · {version.version}</Typography.Title><Space><StatusTag value={dossier.lifecycleStatus} /><StatusTag conclusion value={dossier.complianceConclusion} /></Space></div>
      <Space><Button icon={<DownloadOutlined />} onClick={downloadExport}>导出Excel</Button>{mutable && can('product_dossiers', 'submit') ? <Button type="primary" onClick={submit}>提交复核</Button> : null}{dossier.lifecycleStatus === 'pending_review' && can('product_dossiers', 'review') ? <Button onClick={() => { reviewForm.resetFields(); setReturnOpen(true); }}>退回修改</Button> : null}{dossier.lifecycleStatus === 'pending_review' && can('product_dossiers', 'confirm') ? <Button type="primary" onClick={() => { reviewForm.setFieldsValue({ conclusion: dossier.proposedConclusion === 'not_assessed' ? undefined : dossier.proposedConclusion }); setConfirmOpen(true); }}>确认档案</Button> : null}{dossier.lifecycleStatus === 'confirmed' && can('product_dossiers', 'revise') ? <Button onClick={revise}>创建修订</Button> : null}</Space>
    </Space>
    {mutable ? <Card size="small" title="提交前完整性检查" style={{ marginBottom: 16 }}>
      <Alert
        type={incompleteChecks.length ? 'warning' : 'success'}
        showIcon
        message={incompleteChecks.length ? `还有 ${incompleteChecks.length} 项未完成` : '已满足档案提交条件'}
        description="清单反映已保存的档案内容；修改后请先保存，再提交复核。"
        style={{ marginBottom: 12 }}
      />
      <List
        size="small"
        dataSource={submissionChecklist}
        renderItem={(item) => <List.Item><Space><span aria-label={item.complete ? '已完成' : '未完成'}>{item.complete ? <CheckCircleFilled style={{ color: '#389e0d' }} /> : <CloseCircleFilled style={{ color: '#cf1322' }} />}</span><Typography.Text type={item.complete ? undefined : 'danger'}>{item.text}</Typography.Text></Space></List.Item>}
      />
    </Card> : null}
    <Tabs items={[
      { key: 'overview', label: '概览', children: overview },
      { key: 'baseline-questionnaire', label: '基础问卷', children: renderQuestionnaireAssignments(baseQuestionnaires) },
      ...(appQuestionnaires.length ? [{ key: 'app-questionnaire', label: 'APP专项问卷', children: renderQuestionnaireAssignments(appQuestionnaires) }] : []),
      { key: 'permissions-data', label: '权限与个人信息', children: permissionsAndData },
      { key: 'ropa', label: 'ROPA', children: ropa },
      { key: 'third-party', label: '第三方清单', children: thirdPartyInventory },
      { key: 'third-party-review', label: '第三方安全评审', children: thirdPartyReview },
      { key: 'history', label: '复核记录', children: <Descriptions bordered column={1} items={[{ key: 'submitted', label: '提交时间', children: dossier.submittedAt ? dayjs(dossier.submittedAt).format('YYYY-MM-DD HH:mm') : '—' }, { key: 'confirmed', label: '确认时间', children: dossier.confirmedAt ? dayjs(dossier.confirmedAt).format('YYYY-MM-DD HH:mm') : '—' }, { key: 'source', label: '继承来源', children: dossier.sourceDossierId || '首次建档' }, { key: 'supersedes', label: '修订对象', children: dossier.supersedesDossierId || '—' }]} /> },
    ]} />

    <Modal title={editor?.kind === 'permission' ? '权限类型' : editor?.kind === 'dataItem' ? '个人信息项' : editor?.kind === 'activity' ? 'ROPA处理活动' : editor?.kind === 'thirdPartyService' ? '第三方服务' : '第三方安全评审'} open={Boolean(editor)} onCancel={() => setEditor(null)} onOk={saveEntity} width={760} destroyOnHidden>
      <Form form={entityForm} layout="vertical" preserve={false}>
        {editor?.kind === 'permission' ? <><Form.Item name="platform" label="平台" rules={[{ required: true }]}><Select options={platformOptions} /></Form.Item><Form.Item name="operatingSystem" label="操作系统"><Input placeholder="例如 Android 14 / iOS" /></Form.Item><Form.Item name="permissionName" label="权限类型" rules={[{ required: true }]}><Input placeholder="例如 android.permission.CAMERA" /></Form.Item><Form.Item name="purpose" label="目的和用途" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item><Form.Item name="required" valuePropName="checked"><Checkbox>属于产品必要权限</Checkbox></Form.Item><Form.Item name="dataItemIds" label="关联信息类型"><SearchableSelect mode="multiple" options={dataItems.map((item) => ({ value: item.clientId, label: item.name }))} /></Form.Item></> : null}
        {editor?.kind === 'dataItem' ? <><Form.Item name="clientId" hidden><Input /></Form.Item><Form.Item name="catalogItemId" label="从个人信息基线库选择"><SearchableSelect allowClear options={dataCatalog.map((item) => ({ value: item.id, label: `${item.dataSubject} / ${item.category} / ${item.name}` }))} onChange={applyCatalogItem} /></Form.Item><Form.Item name="name" label="具体信息项" rules={[{ required: true }]}><Input placeholder="例如 手机号" /></Form.Item><Form.Item name="category" label="信息分类" rules={[{ required: true }]}><Input placeholder="例如 联系信息" /></Form.Item><Form.Item name="dataSubjectCategories" label="个人信息主体"><Select mode="tags" /></Form.Item><Form.Item name="purpose" label="目的和用途"><Input.TextArea rows={2} /></Form.Item><Form.Item name="necessity" label="必要或可选"><Select allowClear options={[{ value: '必要', label: '必要' }, { value: '可选', label: '可选' }]} /></Form.Item><Form.Item name="processingMethod" label="处理方式"><Input /></Form.Item><Form.Item name="operatingSystems" label="操作系统"><Select mode="tags" options={platformOptions} /></Form.Item><Form.Item name="source" label="信息来源"><Input /></Form.Item><Space><Form.Item name="sensitive" valuePropName="checked"><Checkbox>敏感信息</Checkbox></Form.Item><Form.Item name="required" valuePropName="checked"><Checkbox>产品必要信息</Checkbox></Form.Item></Space><Form.Item name="notes" label="备注"><Input.TextArea /></Form.Item></> : null}
        {editor?.kind === 'activity' ? <><Form.Item name="name" label="活动名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="purpose" label="数据收集/处理目的" rules={[{ required: true }]}><Input.TextArea /></Form.Item><Form.Item name="legalBasis" label="合法依据" rules={[{ required: true }]}><Select options={['获得个人同意', '合同必要', '法律义务', '重大利益', '公共任务', '合法利益', '不适用'].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="controllerRole" label="个人数据处理角色" rules={[{ required: true }]}><Select options={[{ value: 'controller', label: '个人信息处理者' }, { value: 'processor', label: '个人信息受托处理者' }, { value: 'joint_controller', label: '共同处理者' }]} /></Form.Item><Form.Item name="dataItemIds" label="关联信息类型" rules={[{ required: true }]}><SearchableSelect mode="multiple" options={dataItems.map((item) => ({ value: item.clientId, label: item.name }))} /></Form.Item><Form.Item name="dataSubjectCategories" label="数据主体"><Select mode="tags" /></Form.Item><Form.Item name="dataSource" label="数据来源/收集方式"><Input.TextArea rows={2} /></Form.Item><Form.Item name="writesToLog" label="是否写入日志"><Radio.Group options={[{ value: true, label: '是' }, { value: false, label: '否' }]} /></Form.Item><Form.Item name="dataScale" label="数据规模"><Input /></Form.Item><Form.Item name="transferPath" label="数据传输路径"><Input.TextArea rows={2} /></Form.Item><Form.Item name="transferEncryption" label="数据传输加密措施"><Input.TextArea rows={2} /></Form.Item><Form.Item name="thirdPartyProcessor" label="第三方处理方"><Input /></Form.Item><Form.Item name="thirdPartyProcessingAgreement" label="是否签署数据处理协议"><Radio.Group options={[{ value: true, label: '是' }, { value: false, label: '否' }]} /></Form.Item><Form.Item name="stored" label="数据是否存储"><Radio.Group options={[{ value: true, label: '是' }, { value: false, label: '否' }]} /></Form.Item><Form.Item name="storageSystem" label="数据存储系统/第三方平台"><Input.TextArea rows={2} /></Form.Item><Form.Item name="storageLocation" label="数据存储国家/区域"><Input /></Form.Item><Form.Item name="storageEncryption" label="数据存储加密措施"><Input.TextArea rows={2} /></Form.Item><Form.Item name="accessControl" label="访问控制/权限控制措施"><Input.TextArea rows={2} /></Form.Item><Form.Item name="anonymization" label="数据脱敏/匿名化控制措施"><Input.TextArea rows={2} /></Form.Item><Form.Item name="systemLogging" label="系统是否记录日志"><Input /></Form.Item><Form.Item name="bulkExportAllowed" label="允许批量数据下载/导出"><Radio.Group options={[{ value: true, label: '是' }, { value: false, label: '否' }]} /></Form.Item><Form.Item name="recipientCategories" label="接收方类别"><Select mode="tags" /></Form.Item><Form.Item name="internationalTransfer" valuePropName="checked"><Checkbox>涉及跨境传输</Checkbox></Form.Item><Form.Item name="transferCountries" label="传输国家/地区"><Select mode="tags" /></Form.Item><Form.Item name="transferSafeguards" label="跨境保障措施"><Input.TextArea /></Form.Item><Form.Item name="retentionPeriod" label="数据留存期限" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="deletionMechanism" label="数据删除机制"><Input.TextArea rows={2} /></Form.Item><Form.Item name="retentionBasis" label="数据留存原因/依据"><Input.TextArea rows={2} /></Form.Item><Form.Item name="securityMeasures" label="技术与组织安全措施" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item><Form.Item name="responsibleParty" label="责任主体" rules={[{ required: true }]}><Input /></Form.Item></> : null}
        {editor?.kind === 'thirdPartyService' ? <><Form.Item name="clientId" hidden><Input /></Form.Item><Form.Item name="serviceName" label="服务名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="purpose" label="使用目的和用途" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item><Form.Item name="sharedFields" label="信息共享字段"><Select mode="tags" /></Form.Item><Form.Item name="thirdPartyName" label="第三方名称"><Input /></Form.Item><Form.Item name="securityMethod" label="安全处理方式"><Input.TextArea rows={2} /></Form.Item><Form.Item name="privacyPolicyUrl" label="第三方隐私政策链接"><Input /></Form.Item><Form.Item name="assessmentPassed" label="是否通过第三方评审"><Radio.Group options={[{ value: true, label: '是' }, { value: false, label: '否' }]} /></Form.Item><Form.Item name="assessmentRecord" label="第三方安全评审记录"><Input.TextArea rows={3} /></Form.Item></> : null}
        {editor?.kind === 'thirdPartyAssessment' ? <><Form.Item name="clientId" hidden><Input /></Form.Item><Form.Item name="title" label="评审标题" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="serviceClientId" label="关联第三方服务"><Select allowClear options={thirdPartyServices.map((item) => ({ value: item.clientId, label: item.serviceName }))} /></Form.Item><Typography.Text strong>评估项</Typography.Text><Form.List name="answers">{(fields, { add, remove }) => <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>{fields.map((field) => <Card key={field.key} size="small"><Form.Item {...field} name={[field.name, 'stableKey']} hidden><Input /></Form.Item><Form.Item {...field} name={[field.name, 'section']} label="分类"><Input /></Form.Item><Form.Item {...field} name={[field.name, 'sequence']} label="序号"><Input /></Form.Item><Form.Item {...field} name={[field.name, 'item']} label="评估项" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item><Form.Item {...field} name={[field.name, 'answer']} label="回答"><Select allowClear options={['是', '否', '不适用'].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item {...field} name={[field.name, 'explanation']} label="补充/解释说明"><Input.TextArea rows={2} /></Form.Item><Form.Item {...field} name={[field.name, 'evidence']} label="相关文件/证明材料"><Input.TextArea rows={2} /></Form.Item><Button danger type="text" onClick={() => remove(field.name)}>删除评估项</Button></Card>)}<Button block onClick={() => add({ stableKey: `manual-${Date.now()}`, item: '' })}>添加评估项</Button></Space>}</Form.List></> : null}
      </Form>
    </Modal>
    <Modal title="退回档案" open={returnOpen} onCancel={() => setReturnOpen(false)} onOk={returnForChanges}><Form form={reviewForm} layout="vertical"><Form.Item name="reason" label="退回原因" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item></Form></Modal>
    <Modal title="确认合规档案" open={confirmOpen} onCancel={() => setConfirmOpen(false)} onOk={confirm}><Alert type="warning" showIcon message="确认后档案将锁定，后续纠错必须创建新修订。" style={{ marginBottom: 16 }} /><Form form={reviewForm} layout="vertical"><Form.Item name="conclusion" label="最终合规结论" rules={[{ required: true }]}><Select options={Object.entries(conclusionLabels).filter(([value]) => value !== 'not_assessed').map(([value, option]) => ({ value, label: option.label }))} /></Form.Item></Form></Modal>
    <Modal title="调整适用问卷" open={questionnaireOpen} onCancel={() => setQuestionnaireOpen(false)} onOk={saveQuestionnaires}><Alert type="warning" showIcon message="新增问卷将生成待填写问题；移除问卷不会改变已确认的历史档案。" style={{ marginBottom: 16 }} /><Form form={questionnaireForm} layout="vertical"><Form.Item name="templateIds" label="适用问卷"><LookupSelect kind="product-questionnaires" purpose="product-questionnaire" contextId={id} mode="multiple" /></Form.Item><Form.Item name="reason" label="调整原因" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item></Form></Modal>
  </div></ConfigProvider>;
}
