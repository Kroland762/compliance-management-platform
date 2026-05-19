import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Table, Select, Input, Button, Space, message, Typography, Modal, Tag } from 'antd';
import { DownloadOutlined, PaperClipOutlined, ClearOutlined, EditOutlined } from '@ant-design/icons';
import apiClient from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { getApiErrorMessage } from '../../utils/error';
import { CAN_REVIEW_STATUS } from '../../constants/status';

const { Title, Text } = Typography;

export default function ReviewTask() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const isAdmin = useAuthStore((s) => s.user?.role === 'administrator');
  const [returnVisible, setReturnVisible] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [returnAssigneeIds, setReturnAssigneeIds] = useState<string[]>([]);
  const [complianceFilter, setComplianceFilter] = useState<string | undefined>();
  const [riskLevelFilter, setRiskLevelFilter] = useState<string | undefined>();
  const [deptFilter, setDeptFilter] = useState<string | undefined>();
  const [personFilter, setPersonFilter] = useState<string | undefined>();

  const loadQuestions = () => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      apiClient.get(`/tasks/${id}`),
      apiClient.get(`/tasks/${id}/questions`),
    ]).then(([taskRes, qRes]: any[]) => {
      setTask(taskRes.data);
      setQuestions(qRes.data?.questions || []);
    }).catch((err: any) => {
      console.error('加载任务失败:', err);
      message.error(getApiErrorMessage(err, '加载任务失败'));
    }).finally(() => setLoading(false));
  };

  useEffect(() => { loadQuestions(); }, [id]);

  const updateQuestion = (index: number, field: string, value: string) => {
    const newQs = [...questions];
    newQs[index][field] = value;
    setQuestions(newQs);
  };

  const handleSave = async () => {
    const results = await Promise.allSettled(
      questions.map(q => apiClient.put(`/review/questions/${q.id}`, {
        complianceStatus: q.complianceStatus,
        riskIdentification: q.riskIdentification,
        riskLevel: q.riskLevel,
        remediationMeasures: q.remediationMeasures,
      }))
    );
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      message.error(`${failed.length} 条保存失败`);
      return false;
    }
    message.success('保存成功');
    setIsEditing(false);
    return true;
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    loadQuestions();
  };

  const handleReturn = async () => {
    if (returnAssigneeIds.length === 0) {
      message.error('请选择要退回的责任人');
      return;
    }
    if (!returnReason.trim()) {
      message.error('请输入退回原因');
      return;
    }
    try {
      await apiClient.post(`/tasks/${id}/return`, {
        assigneeIds: returnAssigneeIds,
        reason: returnReason,
      });
      message.success('任务已退回');
      setReturnVisible(false);
      setReturnAssigneeIds([]);
      setReturnReason('');
      navigate('/tasks/review');
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '退回失败'));
    }
  };

  const handleComplete = async () => {
    const saved = await handleSave();
    if (!saved) return;
    try {
      await apiClient.post(`/tasks/${id}/complete-review`);
      message.success('审阅完成');
      navigate('/tasks/review');
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '操作失败'));
    }
  };

  const canEdit = task && (CAN_REVIEW_STATUS as readonly string[]).includes(task.status);
  const canManageWorkflow = task && (CAN_REVIEW_STATUS as readonly string[]).includes(task.status);
  const isAdminEditing = isAdmin && task?.status === 'completed' && isEditing;
  const canEnterEdit = isAdmin && task?.status === 'completed' && !isEditing;

  // 退回目标责任人列表（从题目中提取去重）
  const assigneeOptions = useMemo(() => {
    const seen = new Set<string>();
    return questions
      .filter(q => q.assignedTo)
      .filter(q => {
        if (seen.has(q.assignedTo)) return false;
        seen.add(q.assignedTo);
        return true;
      })
      .map(q => ({
        value: q.assignedTo,
        label: q.responsiblePerson || q.assignedTo?.substring(0, 8) || '未知',
      }));
  }, [questions]);

  // 筛选状态计算
  const deptOptions = [...new Set(questions.map(q => q.responsibleDepartment).filter(Boolean))].map(d => ({ text: d, value: d }));
  const personOptions = [...new Set(questions.map(q => q.responsiblePerson).filter(Boolean))].map(p => ({ text: p, value: p }));
  const deptSelectOptions = deptOptions.map(o => ({ value: o.value, label: o.text }));
  const personSelectOptions = personOptions.map(o => ({ value: o.value, label: o.text }));

  const filteredCount = questions.filter(q => {
    if (complianceFilter && q.complianceStatus !== complianceFilter) return false;
    if (riskLevelFilter && q.riskLevel !== riskLevelFilter) return false;
    if (deptFilter && q.responsibleDepartment !== deptFilter) return false;
    if (personFilter && q.responsiblePerson !== personFilter) return false;
    return true;
  }).length;
  const totalCount = questions.length;

  const clearAllFilters = () => {
    setComplianceFilter(undefined);
    setRiskLevelFilter(undefined);
    setDeptFilter(undefined);
    setPersonFilter(undefined);
  };

  const isEditable = canEdit || isAdminEditing;

  const columns = [
    { title: '序号', dataIndex: 'sequenceNumber', width: 120, fixed: 'left' as const },
    { title: '控制域名', dataIndex: 'controlDomain', width: 130,
      filters: [...new Set(questions.map(q => q.controlDomain))].map(d => ({ text: d, value: d })),
      onFilter: (value: any, record: any) => record.controlDomain === value,
    },
    { title: '控制点', dataIndex: 'controlPoint', width: 160 },
    { title: '参考回答', dataIndex: 'referenceAnswer', width: 150,
      render: (v: string) => v ? <Text style={{ fontSize: 12, color: '#8E8E93' }}>{v}</Text> : '—'
    },
    { title: '责任部门', dataIndex: 'responsibleDepartment', width: 90,
      render: (v: string) => v || '—'
    },
    { title: '责任人', dataIndex: 'responsiblePerson', width: 80,
      render: (v: string) => v || '—'
    },
    { title: '现状说明', dataIndex: 'currentStatusDescription', width: 180,
      render: (v: string) => v ? <Text style={{ fontSize: 12 }}>{v}</Text> : <Text type="secondary">未填写</Text>
    },
    {
      title: '证据文件', width: 140,
      render: (_: any, record: any) => {
        if (!record.evidenceFiles || record.evidenceFiles.length === 0) {
          return <Text type="secondary" style={{ fontSize: 12 }}>无</Text>;
        }
        return record.evidenceFiles.map((ef: any) => (
          <div key={ef.id} style={{ marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
            <PaperClipOutlined style={{ fontSize: 11, color: '#8E8E93' }} />
            <a href={`/api/evidence/${ef.id}/download`} download={ef.originalFilename}
              style={{ fontSize: 12, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ef.originalFilename}
            </a>
          </div>
        ));
      },
    },
    {
      title: '符合性', dataIndex: 'complianceStatus', width: 130,
      render: (v: string, _: any, i: number) => isEditable ? (
        <Select size="small" style={{ width: 110 }} value={v} onChange={val => updateQuestion(i, 'complianceStatus', val)}
          options={[
            { value: 'compliant', label: '符合' },
            { value: 'partially_compliant', label: '部分符合' },
            { value: 'non_compliant', label: '不符合' },
            { value: 'not_applicable', label: '不适用' },
          ]}
        />
      ) : (
        <Tag color={v === 'compliant' ? 'green' : v === 'partially_compliant' ? 'orange' : v === 'non_compliant' ? 'red' : 'default'}>
          {v === 'compliant' ? '符合' : v === 'partially_compliant' ? '部分符合' : v === 'non_compliant' ? '不符合' : v === 'not_applicable' ? '不适用' : v}
        </Tag>
      ),
    },
    {
      title: '风险识别', dataIndex: 'riskIdentification', width: 150,
      render: (v: string, _: any, i: number) => isEditable ? (
        <Input size="small" maxLength={100} value={v} onChange={e => updateQuestion(i, 'riskIdentification', e.target.value)} placeholder="风险描述" />
      ) : (v || '—'),
    },
    {
      title: '风险级别', dataIndex: 'riskLevel', width: 110,
      render: (v: string, _: any, i: number) => isEditable ? (
        <Select size="small" style={{ width: 90 }} value={v} onChange={val => updateQuestion(i, 'riskLevel', val)}
          options={[
            { value: 'high', label: '高' },
            { value: 'medium', label: '中' },
            { value: 'low', label: '低' },
          ]}
          allowClear
        />
      ) : (
        <Tag color={v === 'high' ? 'red' : v === 'medium' ? 'orange' : 'green'}>{v === 'high' ? '高' : v === 'medium' ? '中' : v === 'low' ? '低' : v || '—'}</Tag>
      ),
    },
    {
      title: '补救措施', dataIndex: 'remediationMeasures', width: 200,
      render: (v: string, _: any, i: number) => isEditable ? (
        <Input size="small" maxLength={500} value={v} onChange={e => updateQuestion(i, 'remediationMeasures', e.target.value)} placeholder="补救措施" />
      ) : (v || '—'),
    },
  ];

  if (loading) return <div>加载中...</div>;
  if (!task) return <div>任务不存在</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          审阅: {task.assessmentTarget} ({task.assessmentType})
          {task.status === 'completed' && <Tag color="green">已完成</Tag>}
        </Title>
        <Space>
          {canEnterEdit && (
            <Button type="primary" icon={<EditOutlined />} onClick={() => setIsEditing(true)}>编辑</Button>
          )}
          {isAdminEditing && (
            <>
              <Button onClick={handleCancelEdit}>取消</Button>
              <Button type="primary" onClick={handleSave}>保存</Button>
            </>
          )}
          {canEdit && (
            <>
              <Button onClick={handleSave}>保存进度</Button>
              <Button danger onClick={() => {
                setReturnAssigneeIds([]);
                setReturnReason('');
                setReturnVisible(true);
              }}>退回</Button>
              <Button type="primary" onClick={handleComplete}>完成审阅</Button>
            </>
          )}
        </Space>
      </div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select
          placeholder="符合性筛选"
          value={complianceFilter}
          onChange={setComplianceFilter}
          allowClear
          size="small"
          style={{ width: 130 }}
          options={[
            { value: 'compliant', label: '符合' },
            { value: 'partially_compliant', label: '部分符合' },
            { value: 'non_compliant', label: '不符合' },
            { value: 'not_applicable', label: '不适用' },
          ]}
        />
        <Select
          placeholder="风险级别筛选"
          value={riskLevelFilter}
          onChange={setRiskLevelFilter}
          allowClear
          size="small"
          style={{ width: 130 }}
          options={[
            { value: 'high', label: '高风险' },
            { value: 'medium', label: '中风险' },
            { value: 'low', label: '低风险' },
          ]}
        />
        <Select
          placeholder="责任部门"
          value={deptFilter}
          onChange={setDeptFilter}
          allowClear
          size="small"
          style={{ width: 130 }}
          options={deptSelectOptions}
        />
        <Select
          placeholder="责任人"
          value={personFilter}
          onChange={setPersonFilter}
          allowClear
          size="small"
          style={{ width: 120 }}
          options={personSelectOptions}
        />
        <div style={{ marginLeft: 'auto', fontSize: 13, color: '#8E8E93', display: 'flex', alignItems: 'center', gap: 8 }}>
          {filteredCount !== totalCount ? (
            <>
              <span>{filteredCount} / {totalCount} 条</span>
              <Button size="small" icon={<ClearOutlined />} onClick={clearAllFilters}>清除筛选</Button>
            </>
          ) : (
            <span>共 {totalCount} 条</span>
          )}
        </div>
      </div>
      <Table columns={columns} dataSource={questions} rowKey="id" pagination={false} scroll={{ x: 1700 }} size="small" />

      <Modal
        title="退回任务"
        open={returnVisible}
        onOk={handleReturn}
        onCancel={() => { setReturnVisible(false); setReturnAssigneeIds([]); setReturnReason(''); }}
        okText="确认退回"
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>选择要退回的责任人（可多选）</div>
          <Select
            mode="multiple"
            placeholder="请选择责任人"
            value={returnAssigneeIds}
            onChange={setReturnAssigneeIds}
            options={assigneeOptions}
            style={{ width: '100%' }}
            size="large"
          />
        </div>
        <Input.TextArea
          rows={3}
          value={returnReason}
          onChange={e => setReturnReason(e.target.value)}
          placeholder="请输入退回原因"
        />
      </Modal>
    </div>
  );
}
