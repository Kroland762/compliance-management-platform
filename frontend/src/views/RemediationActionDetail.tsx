import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, List, message, Modal, Space, Tag, Typography, Upload } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { Link, useParams } from 'react-router-dom';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';
import { getApiErrorMessage } from '../utils/error';

export default function RemediationActionDetail() {
  const { id } = useParams();
  const can = useAuthStore((state) => state.hasPermission);
  const [action, setAction] = useState<any>();
  const [verifying, setVerifying] = useState<any>();
  const [comment, setComment] = useState('');
  const load = () => apiClient.get(`/remediation-actions/${id}`).then((response: any) => setAction(response.data));
  useEffect(() => { load(); }, [id]);

  const upload = async (file: File) => {
    const data = new FormData();
    data.append('file', file);
    try {
      await apiClient.post(`/remediation-actions/${id}/evidence`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
      message.success('整改证据已上传');
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '上传失败'));
    }
    return false;
  };

  const submit = async () => {
    try {
      await apiClient.post(`/remediation-actions/${id}/submit`);
      message.success('已提交逐风险复核');
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '提交失败'));
    }
  };

  const verify = async (decision: 'approved' | 'rejected') => {
    try {
      await apiClient.post(`/risks/${verifying.riskId}/actions/${id}/verify`, { decision, comment });
      message.success(decision === 'approved' ? '复核通过' : '已驳回');
      setVerifying(undefined);
      setComment('');
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '复核失败'));
    }
  };

  if (!action) return null;
  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>{action.code} · {action.title}</Typography.Title>
          <Typography.Text type="secondary">{action.description}</Typography.Text>
        </div>
        <Space>
          {can('remediation_actions', 'update') && !['pending_verification', 'completed'].includes(action.status) && (
            <Upload showUploadList={false} beforeUpload={upload}><Button icon={<UploadOutlined />}>上传证据</Button></Upload>
          )}
          {can('remediation_actions', 'submit') && !['pending_verification', 'completed'].includes(action.status) && (
            <Button type="primary" onClick={submit}>提交复核</Button>
          )}
        </Space>
      </Space>
      {action.status === 'pending_verification' && <Alert style={{ marginBottom: 18 }} type="info" message="行动已完成，等待每个关联风险分别复核" showIcon />}
      <Card style={{ marginBottom: 18 }}>
        <Descriptions column={3}>
          <Descriptions.Item label="状态"><Tag>{action.status}</Tag></Descriptions.Item>
          <Descriptions.Item label="责任部门">{action.ownerDepartmentId}</Descriptions.Item>
          <Descriptions.Item label="负责人">{action.ownerUserId}</Descriptions.Item>
          <Descriptions.Item label="开始日期">{action.startDate || '—'}</Descriptions.Item>
          <Descriptions.Item label="期限">{action.dueDate}</Descriptions.Item>
          <Descriptions.Item label="证据">{action.evidenceFiles?.length || 0} 份</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="关联风险与独立复核">
        <List dataSource={action.riskLinks || []} renderItem={(link: any) => (
          <List.Item actions={[
            <Link key="risk" to={`/risks/${link.riskId}`}>查看风险</Link>,
            can('remediation_actions', 'verify') && action.status === 'pending_verification'
              ? <Button key="verify" type="link" onClick={() => setVerifying(link)}>复核</Button>
              : null,
          ]}>
            <List.Item.Meta
              title={`${link.risk?.code} · ${link.risk?.title}`}
              description={`${link.contributionDescription} ｜ 结论：${link.verificationStatus}${link.selfReview ? ' ｜ 单人自审' : ''}`}
            />
          </List.Item>
        )} />
      </Card>
      <Modal
        title="逐风险复核"
        open={Boolean(verifying)}
        onCancel={() => setVerifying(undefined)}
        footer={[
          <Button key="reject" danger onClick={() => verify('rejected')}>驳回</Button>,
          <Button key="approve" type="primary" onClick={() => verify('approved')}>通过</Button>,
        ]}
      >
        <Typography.Paragraph>本次结论只作用于风险 {verifying?.risk?.code}，不会替代其他风险的复核。</Typography.Paragraph>
        <Input.TextArea rows={4} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="复核意见" />
      </Modal>
    </div>
  );
}
