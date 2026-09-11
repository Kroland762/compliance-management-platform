import { useEffect, useState } from 'react';
import { Alert, Button, Card, DatePicker, Descriptions, Form, Input, List, message, Modal, Space, Tag, Typography } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../utils/error';
import { canCloseRisk } from '../utils/relationship';
import { REMEDIATION_STATUS, RISK_CREATION_MODE, RISK_DISCOVERY_SOURCE, RISK_LEVEL, RISK_STATUS, TREATMENT_STRATEGY, VERIFICATION_STATUS } from '../constants/status';
import { useAuthStore } from '../store/auth';

export default function RiskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const can = useAuthStore((state) => state.hasPermission);
  const [risk, setRisk] = useState<any>();
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [form] = Form.useForm();
  const load = () => apiClient.get(`/risks/${id}`).then((response: any) => setRisk(response.data));
  useEffect(() => { load(); }, [id]);

  const action = async (path: string, body: any = {}) => {
    try {
      await apiClient.post(`/risks/${id}/${path}`, body, {
        headers: { 'If-Match': `"${risk.lockVersion}"` },
      });
      message.success('操作成功');
      setAcceptOpen(false);
      setCloseOpen(false);
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '操作失败'));
    }
  };

  const remove = () => Modal.confirm({
    title: '删除待确认风险？', content: '删除后无法恢复，来源摘要会保留在审计日志中。', okText: '删除', okButtonProps: { danger: true },
    onOk: async () => {
      try { await apiClient.delete(`/risks/${id}`); message.success('风险已删除'); navigate('/governance'); }
      catch (error) { message.error(getApiErrorMessage(error, '删除失败')); }
    },
  });

  if (!risk) return null;
  const canClose = canCloseRisk(risk.actionLinks || []);
  const pending = risk.status === 'pending_confirmation';

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>{risk.code} · {risk.title}</Typography.Title>
          <Typography.Text type="secondary">{risk.description}</Typography.Text>
        </div>
        <Space>
          {pending && can('risks', 'update') && <Button onClick={() => navigate(`/risks/${risk.id}/edit`)}>编辑</Button>}
          {pending && can('risks', 'update') && <Button danger onClick={remove}>删除</Button>}
          {pending && can('risks', 'confirm') && <Button type="primary" onClick={() => action('confirm')}>确认风险</Button>}
          {!pending && can('risks', 'accept') && ['open', 'remediating'].includes(risk.status) && <Button onClick={() => setAcceptOpen(true)}>接受风险</Button>}
          {!pending && can('risks', 'close') && ['remediating', 'pending_verification'].includes(risk.status) && <Button disabled={!canClose} onClick={() => setCloseOpen(true)}>关闭风险</Button>}
          {!pending && can('remediation_actions', 'create') && ['open', 'remediating', 'pending_verification'].includes(risk.status) && <Button type="primary" onClick={() => navigate(`/remediation-actions/new?riskId=${risk.id}`)}>创建整改行动</Button>}
        </Space>
      </Space>
      {!canClose && ['remediating', 'pending_verification'].includes(risk.status) && (
        <Alert style={{ marginBottom: 18 }} type="warning" showIcon message="关闭门禁未满足" description="所有必要整改行动必须完成，并在当前风险下逐一复核通过。" />
      )}
      <Card style={{ marginBottom: 18 }}>
        <Descriptions column={3}>
          <Descriptions.Item label="等级"><Tag color={RISK_LEVEL[risk.riskLevel]?.color}>{RISK_LEVEL[risk.riskLevel]?.text || risk.riskLevel}</Tag></Descriptions.Item>
          <Descriptions.Item label="处置策略">{TREATMENT_STRATEGY[risk.treatmentStrategy] || risk.treatmentStrategy}</Descriptions.Item>
          <Descriptions.Item label="状态"><Tag color={RISK_STATUS[risk.status]?.color}>{RISK_STATUS[risk.status]?.text || risk.status}</Tag></Descriptions.Item>
          <Descriptions.Item label="创建方式">{RISK_CREATION_MODE[risk.creationMode] || risk.creationMode}</Descriptions.Item>
          <Descriptions.Item label="发现来源">{RISK_DISCOVERY_SOURCE[risk.discoverySource] || risk.discoverySource}</Descriptions.Item>
          <Descriptions.Item label="责任部门">{risk.ownerDepartment?.name || '—'}</Descriptions.Item>
          <Descriptions.Item label="负责人">{risk.owner?.displayName || '—'}</Descriptions.Item>
          <Descriptions.Item label="审核人">{risk.reviewer?.displayName || '—'}</Descriptions.Item>
          <Descriptions.Item label="创建人">{risk.creator?.displayName || '—'}</Descriptions.Item>
          <Descriptions.Item label="期限">{risk.dueDate || '—'}</Descriptions.Item>
        </Descriptions>
      </Card>
      {risk.creationMode === 'manual' ? <Card title="独立风险来源" style={{ marginBottom: 18 }}>
        <Descriptions column={2}>
          <Descriptions.Item label="发现来源">{RISK_DISCOVERY_SOURCE[risk.discoverySource] || risk.discoverySource}</Descriptions.Item>
          <Descriptions.Item label="来源引用">{risk.sourceReference || '—'}</Descriptions.Item>
          <Descriptions.Item label="来源说明" span={2}>{risk.discoverySourceDetail}</Descriptions.Item>
        </Descriptions>
      </Card> : <>
        <Card style={{ marginBottom: 18 }}><Descriptions><Descriptions.Item label="关联评估项目">{risk.task ? <Link to={`/assessments/${risk.task.id}`}>{risk.task.name || risk.task.assessmentTarget}</Link> : '—'}</Descriptions.Item></Descriptions></Card>
      </>}
      <Space align="start" style={{ width: '100%' }} size={18}>
        {risk.creationMode !== 'manual' && <>
        <Card title={`来源不符合项（${risk.findingLinks?.length || 0}）`} style={{ flex: 1 }}>
          <List dataSource={risk.findingLinks || []} locale={{ emptyText: '无新流程不符合项来源' }} renderItem={(link: any) => (
            <List.Item>
              <div><Typography.Text strong>{link.finding?.code} · {link.finding?.title}</Typography.Text><div><Tag>{link.relationType === 'primary' ? '主要来源' : '支持来源'}</Tag></div></div>
            </List.Item>
          )} />
        </Card>
        <Card title={`来源评估单元（${risk.sources?.length || 0}）`} style={{ flex: 1 }}>
          <List dataSource={risk.sources || []} renderItem={(source: any) => (
            <List.Item>
              <div>
                <Typography.Text strong>{source.controlEvaluation?.sequenceNumber} · {source.controlEvaluation?.controlPoint}</Typography.Text>
                <div><Tag>{source.relationType}</Tag></div>
              </div>
            </List.Item>
          )} />
        </Card>
        </>}
        <Card title={`受影响资产（${risk.affectedAssets?.length || 0}）`} style={{ flex: 1 }}>
          <List dataSource={risk.affectedAssets || []} renderItem={(impact: any) => (
            <List.Item>{impact.asset?.code} · {impact.asset?.name}</List.Item>
          )} />
        </Card>
      </Space>
      <Card title={`整改行动（${risk.actionLinks?.length || 0}）`} style={{ marginTop: 18 }}>
        <List dataSource={risk.actionLinks || []} renderItem={(link: any) => (
          <List.Item actions={[<Link key="detail" to={`/remediation-actions/${link.actionId}`}>查看行动</Link>]}>
            <List.Item.Meta
              title={`${link.action?.code} · ${link.action?.title}`}
              description={`行动状态：${REMEDIATION_STATUS[link.action?.status]?.text || link.action?.status} ｜ 本风险验证：${VERIFICATION_STATUS[link.verificationStatus] || link.verificationStatus} ｜ ${link.isRequired ? '必要' : '非必要'}`}
            />
          </List.Item>
        )} />
      </Card>
      <Modal title="接受风险" open={acceptOpen} onCancel={() => setAcceptOpen(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={(values) => action('accept', { reason: values.reason, reviewDueDate: values.reviewDueDate.format('YYYY-MM-DD') })}>
          <Form.Item name="reason" label="接受原因" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item>
          <Form.Item name="reviewDueDate" label="复查日期" rules={[{ required: true }]}><DatePicker /></Form.Item>
        </Form>
      </Modal>
      <Modal title="关闭风险" open={closeOpen} onCancel={() => setCloseOpen(false)} onOk={() => action('close', { comment: form.getFieldValue('comment') })}>
        <Form form={form} layout="vertical"><Form.Item name="comment" label="关闭说明"><Input.TextArea rows={4} /></Form.Item></Form>
      </Modal>
    </div>
  );
}
