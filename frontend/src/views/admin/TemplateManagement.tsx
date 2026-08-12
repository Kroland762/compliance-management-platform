import { useState, useEffect } from 'react';
import { Table, Button, Space, Modal, Upload, message, Popconfirm, Checkbox, Input, Select, Typography } from 'antd';
import { UploadOutlined, DeleteOutlined, EyeOutlined, CaretLeftOutlined, CaretRightOutlined } from '@ant-design/icons';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../utils/error';
import {
  LOCKED_VISIBLE_EVALUATION_COLUMN_KEYS,
  normalizeEvaluationColumnSchema,
} from '../../utils/evaluationColumns';


export default function TemplateManagement() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [importVisible, setImportVisible] = useState(false);
  const [importName, setImportName] = useState('');
  const [columnOrder, setColumnOrder] = useState<string[]>(() => normalizeEvaluationColumnSchema([]).map((column) => column.key));
  const [importFile, setImportFile] = useState<File>();
  const [importPreview, setImportPreview] = useState<any>();
  const [seriesKey, setSeriesKey] = useState('');
  const [version, setVersion] = useState('1.0');
  const [controlKeyField, setControlKeyField] = useState('序号');
  const [importColumns, setImportColumns] = useState<any[]>([]);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res: any = await apiClient.get('/templates');
      setTemplates(res.data?.items || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchTemplates(); }, []);

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/templates/${id}`);
      message.success('模板已删除');
      fetchTemplates();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '删除失败'));
    }
  };

  const handleView = async (id: string) => {
    try {
      const res: any = await apiClient.get(`/templates/${id}`);
      const columnSchema = normalizeEvaluationColumnSchema(res.data?.columnSchema || []);
      setSelectedTemplate({ ...res.data, columnSchema });
      setColumnOrder(columnSchema.filter((column) => column.visible !== false).map((column) => column.key));
      setDetailVisible(true);
    } catch { message.error('获取详情失败'); }
  };

  const previewImport = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const response: any = await apiClient.post('/templates/import-preview', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportFile(file);
      setImportPreview(response.data);
      setImportColumns(response.data.columnSchema || []);
      setControlKeyField(response.data.suggestedControlKeyField || '序号');
      if (!importName) setImportName(file.name.replace(/\.csv$/i, ''));
    } catch (error) { message.error(getApiErrorMessage(error, 'CSV 预览失败')); }
    return false;
  };

  const handleImport = async () => {
    if (!importFile || !importPreview) { message.warning('请先选择并预览 CSV 文件'); return; }
    const formData = new FormData();
    formData.append('file', importFile);
    formData.append('name', importName || importFile.name.replace('.csv', ''));
    formData.append('standardSeriesKey', seriesKey || `standard-${Date.now()}`);
    formData.append('version', version || '1.0');
    formData.append('controlKeyField', controlKeyField);
    formData.append('columnSchema', JSON.stringify(importColumns));
    try {
      const res: any = await apiClient.post('/templates/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success(res.message || '导入成功');
      setImportVisible(false);
      setImportName('');
      setImportFile(undefined);
      setImportPreview(undefined);
      setSeriesKey('');
      setVersion('1.0');
      fetchTemplates();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '导入失败'));
    }
  };

  const saveColumns = async () => {
    if (!selectedTemplate) return;
    const existing = normalizeEvaluationColumnSchema(selectedTemplate.columnSchema || []);
    const byKey = new Map(existing.map((column: any) => [column.key, column]));
    const visible = columnOrder.map((key) => ({ ...(byKey.get(key) as any), visible: true }));
    const hidden = existing.filter((column: any) => !columnOrder.includes(column.key)).map((column: any) => ({ ...column, visible: false }));
    try {
      const response: any = await apiClient.put(`/templates/${selectedTemplate.id}/columns`, { columns: [...visible, ...hidden] });
      setSelectedTemplate({ ...selectedTemplate, columnSchema: response.data });
      setColumnOrder((response.data || []).filter((column: any) => column.visible !== false).map((column: any) => column.key));
      message.success('列顺序与显示设置已保存');
    } catch (error) { message.error(getApiErrorMessage(error, '保存列配置失败')); }
  };

  const moveColumn = (key: string, direction: -1 | 1) => {
    setColumnOrder((current) => {
      const index = current.indexOf(key);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const columns = [
    { title: '模板名称', dataIndex: 'name', key: 'name' },
    { title: '描述', dataIndex: 'description', key: 'description' },
    { title: '题目数量', dataIndex: 'questionCount', key: 'questionCount' },
    { title: '标准版本', dataIndex: 'version', key: 'version', render: (value: string) => value || '1.0' },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    {
      title: '操作', key: 'actions', render: (_: any, record: any) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleView(record.id)}>详情</Button>
          <Popconfirm title="确定删除此模板？" okText="确认" cancelText="取消" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{
        background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 18, padding: '24px 28px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 0.5px rgba(0,0,0,0.04)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <div />
          <Button type="primary" icon={<UploadOutlined />} onClick={() => setImportVisible(true)}>导入 CSV 模板</Button>
        </div>
        <Table columns={columns} dataSource={templates} rowKey="id" loading={loading} size="small" />
      </div>

      <Modal title="导入 CSV 模板" open={importVisible} onCancel={() => setImportVisible(false)} width={760}
        onOk={handleImport} okText="确认导入" cancelText="取消" okButtonProps={{ disabled: !importPreview || !importName }}>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Upload accept=".csv" beforeUpload={previewImport} maxCount={1} fileList={importFile ? [{ uid: 'csv', name: importFile.name, status: 'done' }] : []} onRemove={() => { setImportFile(undefined); setImportPreview(undefined); }}>
            <Button icon={<UploadOutlined />}>选择并预览 CSV</Button>
          </Upload>
          {importPreview && <>
            <Space style={{ width: '100%' }}>
              <Input addonBefore="模板名称" value={importName} onChange={(event) => setImportName(event.target.value)} />
              <Input addonBefore="标准系列标识" value={seriesKey} placeholder="同一标准跨版本保持一致" onChange={(event) => setSeriesKey(event.target.value)} />
              <Input addonBefore="版本" value={version} onChange={(event) => setVersion(event.target.value)} style={{ width: 180 }} />
            </Space>
            <Select value={controlKeyField} onChange={setControlKeyField} style={{ width: 320 }}
              options={(importPreview.headers || []).map((header: string) => ({ value: header, label: `稳定控制项标识：${header}` }))} />
            <Typography.Text type="secondary">共 {importPreview.rowCount} 行。取消勾选只会隐藏评估表中的列，CSV 数据仍会完整导入。</Typography.Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {importColumns.map((column, index) => <Checkbox key={column.key} disabled={['sequenceNumber', 'controlPoint'].includes(column.key)} checked={column.visible !== false} onChange={(event) => setImportColumns((columns) => columns.map((item, itemIndex) => itemIndex === index ? { ...item, visible: event.target.checked } : item))}>{column.key === 'controlPoint' ? '评估点（必需）' : column.key === 'sequenceNumber' ? '序号（必需）' : column.label}</Checkbox>)}
            </div>
            <Table size="small" pagination={false} dataSource={importPreview.sampleRows} rowKey={(_, index) => String(index)}
              scroll={{ x: 900 }} columns={(importPreview.headers || []).map((header: string) => ({ title: header, dataIndex: header, width: 160, ellipsis: true }))} />
          </>}
        </Space>
      </Modal>

      <Modal title="模板详情" open={detailVisible} onCancel={() => setDetailVisible(false)} width="90%" style={{ top: 20 }} footer={null}>
        {selectedTemplate && (() => {
          const questions = selectedTemplate.templateQuestions || selectedTemplate.questions || [];
          // 列来自服务端模板配置，顺序和显示状态会快照到后续发布的评估项目。
          const configuredColumns = normalizeEvaluationColumnSchema(selectedTemplate.columnSchema || []);
          const allColDefs: any = Object.fromEntries(configuredColumns.map((column: any) => {
            const index = columnOrder.indexOf(column.key);
            const canMoveLeft = index > 0;
            const canMoveRight = index >= 0 && index < columnOrder.length - 1;
            return [column.key, {
              title: <div className="template-column-header">
                <Button
                  type="text"
                  size="small"
                  icon={<CaretLeftOutlined />}
                  aria-label={`左移 ${column.label}`}
                  title={canMoveLeft ? `将“${column.label}”向左移动一列` : '已经是最左侧列'}
                  disabled={!canMoveLeft}
                  onClick={() => moveColumn(column.key, -1)}
                />
                <span className="template-column-header-label">{column.label}</span>
                <Button
                  type="text"
                  size="small"
                  icon={<CaretRightOutlined />}
                  aria-label={`右移 ${column.label}`}
                  title={canMoveRight ? `将“${column.label}”向右移动一列` : '已经是最右侧列'}
                  disabled={!canMoveRight}
                  onClick={() => moveColumn(column.key, 1)}
                />
              </div>,
              dataIndex: column.key.startsWith('extraData.') ? ['extraData', column.key.slice(10)] : column.key,
              width: Math.max(column.width || 160, 180),
              ellipsis: true,
              render: column.source === 'system'
                ? () => <Typography.Text type="secondary">评估发布后显示</Typography.Text>
                : (value: any) => value || '-',
            }];
          }));
          const allColumns = columnOrder.filter(k => allColDefs[k]).map(k => allColDefs[k]);

          return (
          <Table
            className="template-preview-table"
            dataSource={questions}
            size="small"
            rowKey="id"
            columns={allColumns}
            pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 题` }}
            scroll={{ x: Math.max(900, allColumns.reduce((sum: number, column: any) => sum + Number(column.width || 160), 0)) }}
            title={() => (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Space wrap>
                    <Typography.Text strong>列顺序预览</Typography.Text>
                    <Typography.Text type="secondary">表头从左到右就是发布后的顺序；每一列都可使用列名两侧按钮直接调整。序号和评估点仍为必需列，但位置不固定。</Typography.Text>
                  </Space>
                  <Button size="small" type="primary" onClick={saveColumns}>保存列配置</Button>
                </Space>
                <Space wrap size={[12, 4]}>
                  <Typography.Text type="secondary">显示可选字段：</Typography.Text>
                  {configuredColumns.filter((definition: any) => !LOCKED_VISIBLE_EVALUATION_COLUMN_KEYS.has(definition.key)).map((definition: any) => {
                    const isVisible = columnOrder.includes(definition.key);
                    return <Checkbox key={definition.key} checked={isVisible} onChange={(event) => {
                      if (!event.target.checked) {
                        setColumnOrder((current) => current.filter((key) => key !== definition.key));
                        return;
                      }
                      setColumnOrder((current) => {
                        if (current.includes(definition.key)) return current;
                        const configuredIndex = configuredColumns.findIndex((column: any) => column.key === definition.key);
                        const previousVisible = configuredColumns.slice(0, configuredIndex).reverse().find((column: any) => current.includes(column.key));
                        const insertIndex = previousVisible ? current.indexOf(previousVisible.key) + 1 : 0;
                        const next = [...current];
                        next.splice(insertIndex, 0, definition.key);
                        return next;
                      });
                    }}>{definition.label}</Checkbox>;
                  })}
                </Space>
              </Space>
            )}
          />
          );
        })()}
      </Modal>
    </div>
  );
}
