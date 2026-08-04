import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Table, Input, AutoComplete, Button, Upload, message, Typography, Tag, Select, Space } from 'antd';
import { SaveOutlined, UserSwitchOutlined, UploadOutlined, DeleteOutlined, PaperClipOutlined, DownloadOutlined } from '@ant-design/icons';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../utils/error';
import FilePreviewModal, { downloadEvidenceFile, type PreviewableEvidenceFile } from '../../components/FilePreviewModal';

const { Title, Text } = Typography;

export default function TaskConfigure() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [deptOptions, setDeptOptions] = useState<{ value: string }[]>([]);
  const [personnelCache, setPersonnelCache] = useState<Record<number, { value: string }[]>>({});
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchUser, setBatchUser] = useState<string | null>(null);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [previewFile, setPreviewFile] = useState<PreviewableEvidenceFile | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      apiClient.get(`/tasks/${id}`),
      apiClient.get(`/tasks/${id}/questions`),
      apiClient.get('/users?isActive=true'),
    ]).then(([tRes, qRes, rRes]: any[]) => {
      setTask(tRes.data);
      setQuestions(qRes.data?.questions || []);
      setUsersList(rRes.data?.items || []);
    }).finally(() => setLoading(false));
  }, [id]);

  const updateQuestion = (index: number, field: string, value: string) => {
    const newQs = [...questions];
    newQs[index][field] = value;
    setQuestions(newQs);
  };

  const searchDepartments = async (q: string) => {
    if (!q) { setDeptOptions([]); return; }
    try {
      const res: any = await apiClient.get(`/lookup/departments?q=${encodeURIComponent(q)}`);
      setDeptOptions((res.data || []).map((r: any) => ({ value: r.department })));
    } catch { }
  };

  const searchPersonnel = async (q: string, idx: number) => {
    if (!q) return;
    try {
      const dept = questions[idx]?.responsibleDepartment || '';
      const res: any = await apiClient.get(`/lookup/personnel?q=${encodeURIComponent(q)}${dept ? '&department=' + encodeURIComponent(dept) : ''}`);
      const opts = (res.data || []).map((r: any) => ({ value: r.username, label: `${r.username}（${r.department || '-'}）`, userId: r.id, department: r.department }));
      setPersonnelCache(prev => ({ ...prev, [idx]: opts }));
    } catch { }
  };

  const handleBatchAssign = () => {
    if (!batchUser) { message.warning('请先选择一个用户'); return; }
    if (selectedRowKeys.length === 0) { message.warning('请先勾选需要指派的题目'); return; }
    const selectedUser = usersList.find((u: any) => u.id === batchUser);
    const username = selectedUser?.username || '';
    const department = selectedUser?.department || '';
    const newQs = [...questions];
    selectedRowKeys.forEach(key => {
      const idx = newQs.findIndex(q => q.id === key);
      if (idx !== -1) {
        newQs[idx].responsiblePerson = username;
        newQs[idx].responsibleDepartment = department || newQs[idx].responsibleDepartment;
        newQs[idx].assignedTo = batchUser;
      }
    });
    setQuestions(newQs);
    setSelectedRowKeys([]);
    message.success(`已将 ${selectedRowKeys.length} 道题目指派给「${username}」`);
  };

  const handleSave = async () => {
    try {
      await apiClient.put(`/tasks/${id}/configure`, {
        questionAssignments: questions.map(q => ({
          questionId: q.id,
          referenceAnswer: q.referenceAnswer || null,
          responsibleDepartment: q.responsibleDepartment || null,
          responsiblePerson: q.responsiblePerson || null,
          assignedTo: q.assignedTo || null,
        })),
      });
      message.success('已保存');
      navigate('/tasks/review');
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '保存失败'));
    }
  };

  const columns = [
    { title: '序号', dataIndex: 'sequenceNumber', width: 130 },
    { title: '控制域名', dataIndex: 'controlDomain', width: 160 },
    { title: '控制点', dataIndex: 'controlPoint', width: 200 },
    {
      title: '参考回答', dataIndex: 'referenceAnswer', width: 200,
      render: (v: string, _: any, i: number) => (
        <Input.TextArea size="small" rows={2} placeholder="参考回答" value={v || ''}
          onChange={e => updateQuestion(i, 'referenceAnswer', e.target.value)} />
      ),
    },
    {
      title: '历史证据', dataIndex: 'historicalEvidence', width: 230,
      render: (_: any, record: any, i: number) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Upload
            maxCount={1}
            showUploadList={false}
            customRequest={async ({ file, onSuccess, onError }: any) => {
              const formData = new FormData();
              formData.append('file', file);
              try {
                const res: any = await apiClient.post(`/questions/${questions[i].id}/historical-evidence`, formData, {
                  headers: { 'Content-Type': 'multipart/form-data' },
                });
                setQuestions(current => current.map((question, index) => index === i
                  ? { ...question, historicalEvidence: res.data, historicalEvidencePath: res.data.filePath }
                  : question));
                onSuccess(res, file);
                message.success(`“${file.name}”上传成功`);
              } catch (err) {
                onError(err);
                message.error(getApiErrorMessage(err, '上传失败'));
              }
            }}
          >
            <Button size="small" icon={<UploadOutlined />}>{record.historicalEvidence ? '替换文件' : '上传文件'}</Button>
          </Upload>
          {(() => {
            const evidence = record.historicalEvidence as PreviewableEvidenceFile | undefined;
            const filename = evidence?.originalFilename || (record.historicalEvidencePath ? record.historicalEvidencePath.split('/').pop() : '');
            if (filename) {
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <PaperClipOutlined style={{ fontSize: 11, color: '#007AFF' }} />
                  {evidence ? (
                    <Button type="link" size="small" style={{ padding: 0, fontSize: 12, flex: 1, minWidth: 0, textAlign: 'left' }} onClick={() => setPreviewFile(evidence)}>
                      <Text ellipsis={{ tooltip: filename }} style={{ maxWidth: 105 }}>{filename}</Text>
                    </Button>
                  ) : <Text style={{ fontSize: 12, flex: 1 }} ellipsis={{ tooltip: filename }}>{filename}</Text>}
                  {evidence && (
                    <Button type="text" size="small" icon={<DownloadOutlined />} title="下载" onClick={() => downloadEvidenceFile(evidence)} />
                  )}
                  <Button
                    type="text" size="small" danger
                    icon={<DeleteOutlined />}
                    onClick={async () => {
                      try {
                        await apiClient.delete(`/questions/${questions[i].id}/historical-evidence`);
                        setQuestions(current => current.map((question, index) => index === i
                          ? { ...question, historicalEvidence: null, historicalEvidencePath: null }
                          : question));
                        message.success('历史证据已删除');
                      } catch (err: any) {
                        message.error(getApiErrorMessage(err, '删除失败'));
                      }
                    }}
                  />
                </div>
              );
            }
          })()}
        </div>
      ),
    },
    {
      title: '责任部门', dataIndex: 'responsibleDepartment', width: 140,
      render: (v: string, _: any, i: number) => (
        <AutoComplete style={{ width: '100%' }} value={v || undefined}
          placeholder="输入检索" options={deptOptions as any} size="small"
          onSearch={(q: string) => searchDepartments(q)}
          onSelect={(val: string) => updateQuestion(i, 'responsibleDepartment', val)}
          onChange={(val: string) => updateQuestion(i, 'responsibleDepartment', val)}
        />
      ),
    },
    {
      title: '责任人', dataIndex: 'responsiblePerson', width: 160,
      render: (v: string, _: any, i: number) => (
        <AutoComplete style={{ width: '100%' }} value={v || undefined}
          placeholder="搜索普通用户" options={(personnelCache[i] || []) as any} size="small"
          onSearch={(q: string) => searchPersonnel(q, i)}
          onSelect={(val: string, option: any) => {
            updateQuestion(i, 'responsiblePerson', val);
            if (option.department) updateQuestion(i, 'responsibleDepartment', option.department);
            if (option.userId) updateQuestion(i, 'assignedTo', option.userId);
          }}
          onChange={(val: string) => updateQuestion(i, 'responsiblePerson', val)}
        />
      ),
    },
  ];

  if (loading && !task) return <div style={{ textAlign: 'center', padding: 60, color: '#8E8E93' }}>加载中...</div>;
  if (!task) return <div style={{ textAlign: 'center', padding: 60, color: '#8E8E93' }}>任务不存在</div>;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 4 }}>
          配置任务：{task.assessmentTarget}
        </Title>
        <Text style={{ color: '#8E8E93' }}>
          {task.assessmentType} · {questions.length} 题 ·
          <Tag color="default" style={{ marginLeft: 8 }}>待配置</Tag>
        </Text>
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 18, padding: '24px 28px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 0.5px rgba(0,0,0,0.04)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Space>
            <Text strong style={{ fontSize: 15 }}>填写参考回答、分配责任</Text>
            {selectedRowKeys.length > 0 && (
              <Tag>{selectedRowKeys.length} 项已选</Tag>
            )}
          </Space>
          <Space>
            <Select
              placeholder="批量指派给..."
              value={batchUser}
              onChange={setBatchUser}
              allowClear
              size="small"
              style={{ width: 160 }}
              options={usersList.map((u: any) => ({ value: u.id, label: u.username + (u.department ? '（' + u.department + '）' : '') }))}
            />
            <Button size="small" icon={<UserSwitchOutlined />} onClick={handleBatchAssign}
              disabled={selectedRowKeys.length === 0 || !batchUser}>
              批量指派
            </Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}
              style={{ borderRadius: 10, fontWeight: 500 }}>保存</Button>
          </Space>
        </div>
        <Table
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          columns={columns} dataSource={questions} rowKey="id" pagination={false}
          scroll={{ x: 1200 }} size="small" />
      </div>
      <FilePreviewModal file={previewFile} open={Boolean(previewFile)} onClose={() => setPreviewFile(null)} />
    </div>
  );
}
