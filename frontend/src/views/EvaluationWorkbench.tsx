import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Form,
  Input,
  message,
  Modal,
  Pagination,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import { UploadOutlined, WarningOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import apiClient from '../api/client';
import { useAuthStore } from '../store/auth';
import { getApiErrorMessage } from '../utils/error';

const workflow: Record<string, { text: string; color: string }> = {
  pending: { text: '待填写', color: 'default' },
  in_progress: { text: '填写中', color: 'processing' },
  submitted: { text: '待复核', color: 'orange' },
  returned: { text: '已退回', color: 'red' },
  reviewed: { text: '已复核', color: 'green' },
};

export default function EvaluationWorkbench() {
  const { id } = useParams();
  const navigate = useNavigate();
  const can = useAuthStore((state) => state.hasPermission);
  const [task, setTask] = useState<any>();
  const [items, setItems] = useState<any[]>([]);
  const [view, setView] = useState<'control' | 'asset'>('control');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [editing, setEditing] = useState<any>();
  const [reviewing, setReviewing] = useState<any>();
  const [pagination, setPagination] = useState({ page: 1, pageSize: 100, total: 0 });
  const [answerForm] = Form.useForm();
  const [reviewForm] = Form.useForm();

  const load = async (page = pagination.page, pageSize = pagination.pageSize) => {
    setLoading(true);
    try {
      const [taskResponse, evaluationResponse]: any[] = await Promise.all([
        apiClient.get(`/tasks/${id}`),
        apiClient.get(`/tasks/${id}/evaluations`, { params: { page, pageSize } }),
      ]);
      setTask(taskResponse.data);
      setItems(evaluationResponse.data?.items || []);
      setPagination({
        page: evaluationResponse.data?.pagination?.page || page,
        pageSize,
        total: evaluationResponse.data?.pagination?.total || 0,
      });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [id]);

  const grouped = useMemo(() => {
    const map = new Map<string, any>();
    items.forEach((item) => {
      const key = view === 'control' ? item.templateQuestionId : item.assetId;
      const label = view === 'control'
        ? `${item.sequenceNumber} ${item.controlPoint}`
        : `${item.asset?.code || ''} ${item.asset?.name || ''}`;
      const current = map.get(key) || { id: key, label, children: [] };
      current.children.push(item);
      map.set(key, current);
    });
    return [...map.values()];
  }, [items, view]);

  const saveAnswer = async (values: any) => {
    try {
      await apiClient.put(`/evaluations/${editing.id}/answer`, {
        currentStatusDescription: values.description,
        lockVersion: editing.lockVersion,
      });
      message.success('回答已保存');
      setEditing(undefined);
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '保存失败'));
    }
  };

  const submit = async (item: any) => {
    try {
      await apiClient.post(`/evaluations/${item.id}/submit`, {}, {
        headers: { 'If-Match': `"${item.lockVersion}"` },
      });
      message.success('评估单元已提交复核');
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '提交失败'));
    }
  };

  const review = async (values: any) => {
    try {
      await apiClient.post(`/evaluations/${reviewing.id}/review`, values, {
        headers: { 'If-Match': `"${reviewing.lockVersion}"` },
      });
      message.success(values.return ? '已退回' : '复核完成');
      setReviewing(undefined);
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '复核失败'));
    }
  };

  const upload = async (item: any, file: File) => {
    const data = new FormData();
    data.append('file', file);
    try {
      await apiClient.post(`/evaluations/${item.id}/evidence`, data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success('证据已上传');
      load();
    } catch (error) {
      message.error(getApiErrorMessage(error, '上传失败'));
    }
    return false;
  };

  const columns: any[] = [
    { title: view === 'control' ? '资产' : '控制项', render: (_: any, item: any) => view === 'control' ? `${item.asset?.code} · ${item.asset?.name}` : `${item.sequenceNumber} · ${item.controlPoint}` },
    { title: '符合性', dataIndex: 'complianceStatus', width: 120, render: (value: string) => value === 'not_assessed' ? '—' : value },
    { title: '状态', dataIndex: 'workflowStatus', width: 110, render: (value: string) => <Tag color={workflow[value]?.color}>{workflow[value]?.text || value}</Tag> },
    { title: '证据', width: 80, render: (_: any, item: any) => item.evidenceFiles?.length || 0 },
    {
      title: '操作',
      width: 280,
      render: (_: any, item: any) => (
        <Space wrap>
          {can('evaluations', 'answer') && ['pending', 'in_progress', 'returned'].includes(item.workflowStatus) && (
            <Button size="small" onClick={() => {
              setEditing(item);
              answerForm.setFieldsValue({ description: item.currentStatusDescription });
            }}>填写</Button>
          )}
          {can('evaluations', 'answer') && ['pending', 'in_progress', 'returned'].includes(item.workflowStatus) && (
            <Upload showUploadList={false} beforeUpload={(file) => upload(item, file)}>
              <Button size="small" icon={<UploadOutlined />}>证据</Button>
            </Upload>
          )}
          {can('evaluations', 'submit') && item.workflowStatus === 'in_progress' && (
            <Button size="small" type="primary" onClick={() => submit(item)}>提交</Button>
          )}
          {can('evaluations', 'review') && item.workflowStatus === 'submitted' && (
            <Button size="small" onClick={() => { setReviewing(item); reviewForm.resetFields(); }}>复核</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>{task?.name || '评估工作台'}</Typography.Title>
          <Typography.Text type="secondary">每个控制项与资产组合都是独立评估单元</Typography.Text>
        </div>
        <Space>
          <Segmented
            value={view}
            onChange={(value) => setView(value as any)}
            options={[{ value: 'control', label: '按控制项' }, { value: 'asset', label: '按资产' }]}
          />
          <Button
            icon={<WarningOutlined />}
            disabled={!selected.length}
            onClick={() => navigate(`/risks?taskId=${id}&sources=${selected.join(',')}`)}
          >由选中单元创建风险</Button>
        </Space>
      </Space>
      {grouped.map((group) => (
        <div key={group.id} style={{ marginBottom: 18 }}>
          <Typography.Text strong>{group.label}</Typography.Text>
          <Table
            style={{ marginTop: 8 }}
            rowKey="id"
            size="small"
            loading={loading}
            pagination={false}
            dataSource={group.children}
            columns={columns}
            rowSelection={{
              selectedRowKeys: selected,
              onChange: setSelected,
              getCheckboxProps: (item: any) => ({ disabled: item.workflowStatus !== 'reviewed' }),
            }}
          />
        </div>
      ))}
      <Pagination
        current={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        showSizeChanger
        pageSizeOptions={[20, 50, 100]}
        showTotal={(total) => `共 ${total} 个评估单元`}
        onChange={(page, pageSize) => {
          setSelected([]);
          void load(page, pageSize);
        }}
      />
      <Modal title="填写评估单元" open={Boolean(editing)} onCancel={() => setEditing(undefined)} onOk={() => answerForm.submit()}>
        <Form form={answerForm} layout="vertical" onFinish={saveAnswer}>
          <Form.Item name="description" label="现状说明" rules={[{ required: true }]}>
            <Input.TextArea rows={6} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title="复核评估单元" open={Boolean(reviewing)} onCancel={() => setReviewing(undefined)} onOk={() => reviewForm.submit()}>
        <Form form={reviewForm} layout="vertical" onFinish={review}>
          <Form.Item name="complianceStatus" label="符合性结论" rules={[{ required: true }]}>
            <Select options={[
              { value: 'compliant', label: '符合' },
              { value: 'partial', label: '部分符合' },
              { value: 'non_compliant', label: '不符合' },
              { value: 'not_applicable', label: '不适用' },
            ]} />
          </Form.Item>
          <Form.Item name="return" label="处理方式" initialValue={false}>
            <Select options={[{ value: false, label: '确认结论' }, { value: true, label: '退回填写人' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
