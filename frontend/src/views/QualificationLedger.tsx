import { useEffect, useState } from 'react';
import { Button, DatePicker, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../utils/error';
import { useAuthStore } from '../store/auth';

const STATUS_LABELS: Record<string, string> = {
  valid: '有效',
  expiring: '即将到期',
  expired: '已过期',
  missing: '缺少有效期',
};

const STATUS_COLORS: Record<string, string> = {
  valid: 'green',
  expiring: 'orange',
  expired: 'red',
  missing: 'default',
};

const CATEGORY_OPTIONS = [
  { value: '企业资质', label: '企业资质' },
  { value: '人员证书', label: '人员证书' },
  { value: '供应商资质', label: '供应商资质' },
  { value: '系统备案', label: '系统备案' },
  { value: '制度文件', label: '制度文件' },
  { value: '其他', label: '其他' },
];

export default function QualificationLedger() {
  const can = useAuthStore(s => s.hasPermission);
  const canCreate = can('qualifications', 'create');
  const canUpdate = can('qualifications', 'update');
  const canDelete = can('qualifications', 'delete');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [filters, setFilters] = useState({ keyword: '', category: '', status: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ total: 0, valid: 0, expiring: 0, expired: 0, missing: 0 });
  const [departments, setDepartments] = useState<any[]>([]);
  const [personnel, setPersonnel] = useState<any[]>([]);
  const [form] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res: any = await apiClient.get(`/qualifications${params.toString() ? `?${params}` : ''}`);
      setItems(res.data?.items || []);
      setTotal(res.data?.pagination?.total || 0);
      setStats(res.data?.summary || { total: 0, valid: 0, expiring: 0, expired: 0, missing: 0 });
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '加载资质台账失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [filters, page, pageSize]);
  useEffect(() => {
    Promise.all([apiClient.get('/lookup/departments'), apiClient.get('/lookup/personnel')])
      .then(([departmentResponse, personnelResponse]: any[]) => {
        setDepartments(departmentResponse.data || []);
        setPersonnel(personnelResponse.data || []);
      })
      .catch(() => message.error('部门或负责人选项加载失败'));
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record: any) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      issueDate: record.issueDate ? dayjs(record.issueDate) : null,
      expiryDate: record.expiryDate ? dayjs(record.expiryDate) : null,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const body = {
        ...values,
        issueDate: values.issueDate ? values.issueDate.format('YYYY-MM-DD') : null,
        expiryDate: values.expiryDate ? values.expiryDate.format('YYYY-MM-DD') : null,
      };
      if (editing) {
        await apiClient.put(`/qualifications/${editing.id}`, body);
        message.success('资质记录已更新');
      } else {
        await apiClient.post('/qualifications', body);
        message.success('资质记录已创建');
      }
      setModalOpen(false);
      fetchData();
    } catch (err: any) {
      if (err?.error?.message) message.error(err.error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/qualifications/${id}`);
      message.success('资质记录已删除');
      fetchData();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '删除失败'));
    }
  };

  const columns = [
    { title: '资质名称', dataIndex: 'name', width: 180, fixed: 'left' as const },
    { title: '类型', dataIndex: 'category', width: 110 },
    { title: '状态', dataIndex: 'status', width: 100, render: (value: string) => (
      <Tag color={STATUS_COLORS[value]}>{STATUS_LABELS[value] || value}</Tag>
    ) },
    { title: '证书编号', dataIndex: 'certificateNo', width: 140, render: (v: string) => v || '-' },
    { title: '签发机构', dataIndex: 'issuer', width: 160, render: (v: string) => v || '-' },
    { title: '所属公司', dataIndex: 'ownerCompany', width: 140, render: (v: string) => v || '-' },
    {
      title: '所属部门',
      dataIndex: 'ownerDepartmentId',
      width: 120,
      render: (value: string) => departments.find((item) => item.id === value)?.name || '-',
    },
    {
      title: '负责人',
      dataIndex: 'responsibleUserId',
      width: 100,
      render: (value: string) => personnel.find((item) => item.userId === value)?.displayName || '-',
    },
    { title: '签发日期', dataIndex: 'issueDate', width: 110, render: (v: string) => v || '-' },
    { title: '有效期至', dataIndex: 'expiryDate', width: 110, render: (v: string) => v || '-' },
    { title: '附件', dataIndex: 'attachmentUrl', width: 90, render: (v: string) => v ? <a href={v} target="_blank" rel="noreferrer">查看</a> : '-' },
    {
      title: '操作',
      width: 128,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <Space size={4}>
          {canUpdate && <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>}
          {canDelete && (
            <Popconfirm title="确定删除此资质记录？" okText="确认" cancelText="取消" onConfirm={() => handleDelete(record.id)}>
              <Button size="small" type="link" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(120px, 1fr))', gap: 12, marginBottom: 16 }} className="qualification-stat-grid">
        {[
          ['台账总数', stats.total, '#007AFF'],
          ['有效', stats.valid, '#34C759'],
          ['即将到期', stats.expiring, '#FF9500'],
          ['已过期', stats.expired, '#FF3B30'],
          ['缺少有效期', stats.missing, '#8E8E93'],
        ].map(([label, value, color]) => (
          <div key={label as string} style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ color: '#636366', fontSize: 12, marginBottom: 6 }}>{label}</div>
            <div style={{ color: color as string, fontSize: 24, fontWeight: 700 }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="filter-toolbar">
        <div className="filter-toolbar-content">
          <Input.Search
            placeholder="搜索名称、编号、机构、公司、负责人"
            allowClear
            enterButton="查询"
            style={{ width: 280 }}
            onSearch={value => { setPage(1); setFilters(f => ({ ...f, keyword: value.trim() })); }}
          />
          <Select
            placeholder="资质类型"
            allowClear
            value={filters.category || undefined}
            onChange={value => { setPage(1); setFilters(f => ({ ...f, category: value || '' })); }}
            style={{ width: 130 }}
            options={CATEGORY_OPTIONS}
          />
          <Select
            placeholder="状态"
            allowClear
            value={filters.status || undefined}
            onChange={value => { setPage(1); setFilters(f => ({ ...f, status: value || '' })); }}
            style={{ width: 130 }}
            options={[
              { value: 'valid', label: '有效' },
              { value: 'expiring', label: '即将到期' },
              { value: 'expired', label: '已过期' },
              { value: 'missing', label: '缺少有效期' },
            ]}
          />
          {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增资质</Button>}
        </div>
      </div>

      <Table
        columns={columns}
        dataSource={items}
        rowKey="id"
        loading={loading}
        size="small"
        scroll={{ x: 1510 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: count => `共 ${count} 条`,
          onChange: (nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize); },
        }}
      />

      <Modal
        title={editing ? '编辑资质' : '新增资质'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        okText="确认"
        cancelText="取消"
        width={720}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <div className="responsive-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="name" label="资质名称" rules={[{ required: true, message: '请输入资质名称' }]}>
              <Input placeholder="例如：ISO 27001 认证证书" />
            </Form.Item>
            <Form.Item name="category" label="资质类型" rules={[{ required: true, message: '请选择资质类型' }]}>
              <Select options={CATEGORY_OPTIONS} />
            </Form.Item>
            <Form.Item name="certificateNo" label="证书编号">
              <Input placeholder="证书或备案编号" />
            </Form.Item>
            <Form.Item name="issuer" label="签发机构">
              <Input placeholder="签发机构/监管机构" />
            </Form.Item>
            <Form.Item name="ownerCompany" label="所属公司">
              <Input placeholder="例如：集团总部/子公司名称" />
            </Form.Item>
            <Form.Item name="ownerDepartmentId" label="归属部门" rules={[{ required: true, message: '请选择归属部门' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={departments.map((department) => ({
                  value: department.id,
                  label: `${department.name} (${department.code})`,
                }))}
              />
            </Form.Item>
            <Form.Item name="responsibleUserId" label="负责人">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                options={personnel.map((member) => ({
                  value: member.userId,
                  label: `${member.displayName || member.username} (${member.primaryDepartmentName || '-'})`,
                }))}
              />
            </Form.Item>
            <Form.Item name="issueDate" label="签发日期">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="expiryDate" label="有效期至">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="attachmentUrl" label="附件链接">
            <Input placeholder="证书或材料文件链接" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="补充说明、续期要求或材料位置" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
