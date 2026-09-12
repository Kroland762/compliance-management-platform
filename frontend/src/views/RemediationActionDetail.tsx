import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  Input,
  List,
  message,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Typography,
  Upload,
} from 'antd';
import { DeleteOutlined, DownloadOutlined, EditOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Link, useParams } from 'react-router-dom';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';
import { getApiErrorMessage } from '../utils/error';
import { REMEDIATION_STATUS, VERIFICATION_STATUS } from '../constants/status';

export default function RemediationActionDetail() {
  const { id } = useParams();
  const can = useAuthStore((state) => state.hasPermission);
  const [action, setAction] = useState<any>();
  const [verifying, setVerifying] = useState<any>();
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  const [editForm] = Form.useForm();
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
      await apiClient.post(`/remediation-actions/${id}/submit`, {}, {
        headers: {
          'If-Match': `"${action.lockVersion}"`,
          'Idempotency-Key': crypto.randomUUID(),
        },
      });
      message.success('已提交整改验证');
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '提交失败'));
    }
  };

  const verify = async (decision: 'approved' | 'rejected') => {
    if (decision === 'rejected' && !comment.trim()) {
      message.error('驳回时请填写原因');
      return;
    }
    try {
      const verifyPath = verifying.findingId
        ? `/findings/${verifying.findingId}/actions/${id}/verify`
        : `/risks/${verifying.riskId}/actions/${id}/verify`;
      await apiClient.post(verifyPath, { decision, comment }, {
        headers: { 'If-Match': `"${action.lockVersion}"` },
      });
      message.success(decision === 'approved' ? '复核通过' : '已驳回');
      setVerifying(undefined);
      setComment('');
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '复核失败'));
    }
  };

  const openEdit = () => {
    editForm.setFieldsValue({
      title: action.title,
      description: action.description,
      progressNote: action.progressNote,
      dueDate: action.dueDate ? dayjs(action.dueDate) : undefined,
    });
    setEditing(true);
  };

  const save = async (values: any) => {
    try {
      await apiClient.put(`/remediation-actions/${id}`, {
        title: values.title,
        description: values.description,
        progressNote: values.progressNote,
        dueDate: values.dueDate.format('YYYY-MM-DD'),
      }, {
        headers: { 'If-Match': `"${action.lockVersion}"` },
      });
      message.success('整改进展已保存');
      setEditing(false);
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '保存失败'));
    }
  };

  const downloadEvidence = async (evidence: any) => {
    try {
      const blob = await apiClient.get(
        `/remediation-actions/${id}/evidence/${evidence.id}/download`,
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(blob as unknown as Blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = evidence.originalFilename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      message.error(getApiErrorMessage(error, '下载失败'));
    }
  };

  const deleteEvidence = async (evidenceId: string) => {
    try {
      await apiClient.delete(`/remediation-actions/${id}/evidence/${evidenceId}`);
      message.success('证据已删除');
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '删除失败'));
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
          {can('remediation_actions', 'update') && !['pending_verification', 'completed', 'cancelled'].includes(action.status) && (
            <Button icon={<EditOutlined />} onClick={openEdit}>填写进展</Button>
          )}
          {can('remediation_actions', 'update') && !['pending_verification', 'completed'].includes(action.status) && (
            <Upload showUploadList={false} beforeUpload={upload}><Button icon={<UploadOutlined />}>上传证据</Button></Upload>
          )}
          {can('remediation_actions', 'submit') && !['pending_verification', 'completed'].includes(action.status) && (
            <Button type="primary" onClick={submit}>提交复核</Button>
          )}
        </Space>
      </Space>
      {action.status === 'pending_verification' && <Alert style={{ marginBottom: 18 }} type="info" message="行动已提交，等待所有必要关联分别验证" showIcon />}
      <Card style={{ marginBottom: 18 }}>
        <Descriptions column={3}>
          <Descriptions.Item label="状态"><Tag color={REMEDIATION_STATUS[action.status]?.color}>{REMEDIATION_STATUS[action.status]?.text || action.status}</Tag></Descriptions.Item>
          <Descriptions.Item label="责任部门">{action.ownerDepartment?.name || '—'}</Descriptions.Item>
          <Descriptions.Item label="负责人">{action.owner?.displayName || '—'}</Descriptions.Item>
          <Descriptions.Item label="开始日期">{action.startDate || '—'}</Descriptions.Item>
          <Descriptions.Item label="期限">{action.dueDate}</Descriptions.Item>
          <Descriptions.Item label="证据">{action.evidenceFiles?.length || 0} 份</Descriptions.Item>
          <Descriptions.Item label="进展说明" span={3}>{action.progressNote || '尚未填写'}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title={`整改证据（${action.evidenceFiles?.length || 0}）`} style={{ marginBottom: 18 }}>
        <List
          locale={{ emptyText: '尚未上传整改证据' }}
          dataSource={action.evidenceFiles || []}
          renderItem={(evidence: any) => (
            <List.Item actions={[
              <Button
                key="download"
                type="link"
                icon={<DownloadOutlined />}
                onClick={() => downloadEvidence(evidence)}
              >下载</Button>,
              can('remediation_actions', 'update') && !['pending_verification', 'completed'].includes(action.status)
                ? (
                  <Popconfirm
                    key="delete"
                    title="确认删除这份证据？"
                    onConfirm={() => deleteEvidence(evidence.id)}
                  >
                    <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                )
                : null,
            ]}>
              <List.Item.Meta
                title={evidence.originalFilename}
                description={`${evidence.mimeType || '未知类型'} · ${evidence.fileSize || 0} 字节`}
              />
            </List.Item>
          )}
        />
      </Card>
      <Card title="关联不符合项与独立验证" style={{ marginBottom: 18 }}>
        <List locale={{ emptyText: '无直接关联的不符合项' }} dataSource={action.findingLinks || []} renderItem={(link: any) => (
          <List.Item actions={[
            can('findings', 'verify') && action.status === 'pending_verification'
              ? <Button key="verify" type="link" onClick={() => setVerifying(link)}>验证</Button>
              : null,
          ]}>
            <List.Item.Meta
              title={`${link.finding?.code} · ${link.finding?.title}`}
              description={`${link.contributionDescription} ｜ 结论：${VERIFICATION_STATUS[link.verificationStatus] || link.verificationStatus}`}
            />
          </List.Item>
        )} />
      </Card>
      <Card title="关联风险与独立验证">
        <List dataSource={action.riskLinks || []} renderItem={(link: any) => (
          <List.Item actions={[
            <Link key="risk" to={`/risks/${link.riskId}`}>查看风险</Link>,
            (can('risks', 'verify') || can('remediation_actions', 'verify')) && action.status === 'pending_verification'
              ? <Button key="verify" type="link" onClick={() => setVerifying(link)}>验证</Button>
              : null,
          ]}>
            <List.Item.Meta
              title={`${link.risk?.code} · ${link.risk?.title}`}
              description={`${link.contributionDescription} ｜ 结论：${VERIFICATION_STATUS[link.verificationStatus] || link.verificationStatus}`}
            />
          </List.Item>
        )} />
      </Card>
      <Modal
        title="整改验证"
        open={Boolean(verifying)}
        onCancel={() => setVerifying(undefined)}
        footer={[
          <Button key="reject" danger onClick={() => verify('rejected')}>驳回</Button>,
          <Button key="approve" type="primary" onClick={() => verify('approved')}>通过</Button>,
        ]}
      >
        <Typography.Paragraph>本次结论只作用于 {verifying?.finding?.code || verifying?.risk?.code}，不会替代其他关联项的验证。</Typography.Paragraph>
        <Input.TextArea rows={4} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="复核意见" />
      </Modal>
      <Modal
        title="填写整改进展"
        open={editing}
        onCancel={() => setEditing(false)}
        onOk={() => editForm.submit()}
      >
        <Form form={editForm} layout="vertical" onFinish={save}>
          <Form.Item name="title" label="行动标题" rules={[{ required: true }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="description" label="整改方案" rules={[{ required: true }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="progressNote" label="进展说明" rules={[{ required: true }]}>
            <Input.TextArea rows={4} placeholder="说明已完成的工作、验证方式和剩余事项" />
          </Form.Item>
          <Form.Item name="dueDate" label="完成期限" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
