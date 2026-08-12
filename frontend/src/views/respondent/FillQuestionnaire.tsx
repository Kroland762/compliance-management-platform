import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Table, Input, Button, Upload, message, Typography, Tag } from 'antd';
import { UploadOutlined, SaveOutlined, SendOutlined, HistoryOutlined, PaperClipOutlined, DownloadOutlined } from '@ant-design/icons';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../utils/error';
import { useAuthStore } from '../../store/auth';
import useQuestionsSync from '../../hooks/useQuestionsSync';
import { CAN_EDIT_TASK_STATUS } from '../../constants/status';
import FilePreviewModal, { downloadEvidenceFile, type PreviewableEvidenceFile } from '../../components/FilePreviewModal';

const { Title, Text } = Typography;

export default function FillQuestionnaire() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const [task, setTask] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [previewFile, setPreviewFile] = useState<PreviewableEvidenceFile | null>(null);
  const refreshQuestions = useQuestionsSync(id);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      apiClient.get(`/tasks/${id}`),
      apiClient.get(`/tasks/${id}/questions`),
    ]).then(([tRes, qRes]: any[]) => {
      setTask(tRes.data);
      setQuestions(qRes.data?.questions || []);
    }).catch((err: any) => {
      console.error('加载任务失败:', err);
      message.error(getApiErrorMessage(err, '加载任务失败'));
    }).finally(() => setLoading(false));
  }, [id]);

  const updateAnswer = (index: number, value: string) => {
    const newQs = [...questions];
    newQs[index].currentStatusDescription = value;
    newQs[index].answerStatus = value ? 'answered' : 'pending';
    setQuestions(newQs);
  };

  const handleSave = async () => {
    try {
      for (const q of questions) {
        if (q.currentStatusDescription !== undefined) {
          await apiClient.put(`/questions/${q.id}/answer`, { currentStatusDescription: q.currentStatusDescription });
        }
      }
      message.success('草稿已保存');
    } catch (err: any) {
      message.error('保存失败：' + getApiErrorMessage(err, '未知错误'));
    }
  };

  const handleUpload = async (questionId: string, file: File) => {
    if (file.size > 52428800) { message.error('文件大小不能超过50MB'); return false; }
    const formData = new FormData();
    formData.append('file', file);
    try {
      await apiClient.post(`/questions/${questionId}/evidence`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      message.success(`"${file.name}" 上传成功`);
      setQuestions(await refreshQuestions(questions));
    } catch (err: any) { message.error(getApiErrorMessage(err, '上传失败')); }
    return false;
  };

  const handleDeleteEvidence = async (evidenceId: string) => {
    try {
      await apiClient.delete(`/evidence/${evidenceId}`);
      message.success('证据已删除');
      setQuestions(await refreshQuestions(questions));
    } catch { message.error('删除失败'); }
  };

  const handleSubmit = async () => {
    const unanswered = questions.filter(q => !q.currentStatusDescription);
    if (unanswered.length > 0) { message.error(`还有 ${unanswered.length} 个问题未填写现状说明`); return; }
    setSubmitting(true);
    try {
      await handleSave();
      await apiClient.post(`/tasks/${id}/submit`);
      message.success('问卷已提交');
      navigate('/my-tasks');
    } catch (err: any) { message.error(getApiErrorMessage(err, '提交失败')); }
    finally { setSubmitting(false); }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: '#8E8E93' }}>加载中...</div>;
  if (!task) return <div style={{ textAlign: 'center', padding: 60, color: '#8E8E93' }}>任务不存在</div>;

  const canEdit = task && (
    (CAN_EDIT_TASK_STATUS as readonly string[]).includes(task.status) ||
    task.returnedAssignees?.includes(currentUser?.id)
  );
  const answeredCount = questions.filter(q => q.answerStatus === 'answered').length;

  const columns = [
    { title: '序号', dataIndex: 'sequenceNumber', width: 120, fixed: 'left' as const },
    { title: '控制域名', dataIndex: 'controlDomain', width: 140 },
    { title: '控制点', dataIndex: 'controlPoint', width: 180 },
    { title: '历史证据', dataIndex: 'historicalEvidence', width: 150,
      render: (evidence: PreviewableEvidenceFile | null) => evidence ? (
        <Button size="small" type="link" icon={<HistoryOutlined />} onClick={() => setPreviewFile(evidence)}>预览</Button>
      ) : <Text type="secondary">无</Text> },
    { title: '责任部门', dataIndex: 'responsibleDepartment', width: 100, render: (v: string) => v || <Text type="secondary">—</Text> },
    { title: '责任人', dataIndex: 'responsiblePerson', width: 90, render: (v: string) => v || <Text type="secondary">—</Text> },
    {
      title: '现状说明', dataIndex: 'currentStatusDescription', width: 260,
      render: (v: string, _: any, i: number) => canEdit ? (
        <Input.TextArea value={v || ''} onChange={e => updateAnswer(i, e.target.value)} maxLength={500} rows={2}
          placeholder="请输入现状说明（必填）" showCount style={{ fontSize: 13 }} />
      ) : (
        <Text style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{v || '—'}</Text>
      ),
    },
    {
      title: '证据文件', width: 180,
      render: (_: any, record: any) => (
        <div>
          {record.evidenceFiles?.map((ef: any) => (
            <div key={ef.id} style={{ marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              <PaperClipOutlined style={{ fontSize: 11, color: '#8E8E93' }} />
              <Button type="link" size="small" onClick={() => setPreviewFile(ef)}
                style={{ padding: 0, fontSize: 12, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ef.originalFilename}</Button>
              <Button type="text" size="small" icon={<DownloadOutlined />} title="下载" style={{ padding: 0 }} onClick={() => downloadEvidenceFile(ef)} />
              {canEdit && <Button type="link" size="small" danger style={{ padding: 0, fontSize: 11 }} onClick={() => handleDeleteEvidence(ef.id)}>删除</Button>}
            </div>
          ))}
          {canEdit && (
            <Upload beforeUpload={(file) => handleUpload(record.id, file)} showUploadList={false} accept="*" maxCount={1}>
              <Button size="small" icon={<UploadOutlined />} style={{ marginTop: record.evidenceFiles?.length ? 4 : 0 }}>上传证据</Button>
            </Upload>
          )}
        </div>
      ),
    },
    {
      title: '状态', dataIndex: 'answerStatus', width: 70, fixed: 'right' as const,
      render: (v: string) => v === 'answered' ? <Tag color="green">已答</Tag> : <Tag color="red">待答</Tag>,
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 4 }}>填写问卷：{task.assessmentTarget}</Title>
        <Text style={{ color: '#8E8E93' }}>{task.assessmentType} · 共 {questions.length} 题 · 已答 {answeredCount} · 未答 {questions.length - answeredCount}</Text>
      </div>
      <div style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 18, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 0.5px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16, gap: 8 }}>
          {canEdit && (
            <>
              <Button icon={<SaveOutlined />} onClick={handleSave}>保存草稿</Button>
              <Button type="primary" icon={<SendOutlined />} onClick={handleSubmit} loading={submitting}
                style={{ borderRadius: 10, fontWeight: 500 }}>提交问卷</Button>
            </>
          )}
        </div>
        <Table columns={columns} dataSource={questions} rowKey="id" pagination={false} scroll={{ x: 1500 }} size="small" />
      </div>
      <FilePreviewModal file={previewFile} open={Boolean(previewFile)} onClose={() => setPreviewFile(null)} />
    </div>
  );
}
