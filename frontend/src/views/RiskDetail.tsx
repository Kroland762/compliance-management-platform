import { useEffect, useState } from 'react';
import { Alert, Button, Card, DatePicker, Descriptions, Form, Input, List, message, Modal, Select, Space, Tag, Typography } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../utils/error';
import { canCloseRisk } from '../utils/relationship';

export default function RiskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [risk, setRisk] = useState<any>();
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [form] = Form.useForm();
  const load = () => apiClient.get(`/risks/${id}`).then((response: any) => setRisk(response.data));
  useEffect(() => { load(); }, [id]);

  const action = async (path: string, body: any = {}) => {
    try {
      await apiClient.post(`/risks/${id}/${path}`, body);
      message.success('操作成功');
      setAcceptOpen(false);
      setCloseOpen(false);
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '操作失败'));
    }
  };

  if (!risk) return null;
  const canClose = canCloseRisk(risk.actionLinks || []);

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>{risk.code} · {risk.title}</Typography.Title>
          <Typography.Text type="secondary">{risk.description}</Typography.Text>
        </div>
        <Space>
          {risk.status === 'pending_confirmation' && <Button type="primary" onClick={() => action('confirm')}>确认风险</Button>}
          {!['closed', 'accepted'].includes(risk.status) && <Button onClick={() => setAcceptOpen(true)}>接受风险</Button>}
          <Button disabled={!canClose} onClick={() => setCloseOpen(true)}>关闭风险</Button>
          <Button type="primary" onClick={() => navigate(`/remediation-actions/new?riskId=${risk.id}`)}>创建整改行动</Button>
        </Space>
      </Space>
      {!canClose && !['closed', 'accepted'].includes(risk.status) && (
        <Alert style={{ marginBottom: 18 }} type="warning" showIcon message="关闭门禁未满足" description="所有必要整改行动必须完成，并在当前风险下逐一复核通过。" />
      )}
      <Card style={{ marginBottom: 18 }}>
        <Descriptions column={3}>
          <Descriptions.Item label="等级"><Tag color={risk.riskLevel === 'high' ? 'red' : 'orange'}>{risk.riskLevel}</Tag></Descriptions.Item>
          <Descriptions.Item label="处置策略">{risk.treatmentStrategy}</Descriptions.Item>
          <Descriptions.Item label="状态">{risk.status}</Descriptions.Item>
          <Descriptions.Item label="责任部门">{risk.ownerDepartmentId}</Descriptions.Item>
          <Descriptions.Item label="负责人">{risk.ownerUserId}</Descriptions.Item>
          <Descriptions.Item label="期限">{risk.dueDate || '—'}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Space align="start" style={{ width: '100%' }} size={18}>
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
              description={`行动状态：${link.action?.status} ｜ 本风险复核：${link.verificationStatus} ｜ ${link.isRequired ? '必要' : '非必要'}`}
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
