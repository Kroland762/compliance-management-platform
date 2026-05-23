import { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, InputNumber, Button, Typography, message, Divider, Space, Tag, Tooltip, Upload } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftOutlined, PlusOutlined, DeleteOutlined, InfoCircleOutlined, UploadOutlined, DownOutlined, RightOutlined } from '@ant-design/icons';
import { dataSourceApi, type DataSource } from '../../api/account';
import { getApiErrorMessage } from '../../utils/error';
import apiClient from '../../api/client';

const { Title, Text } = Typography;

const DB_TYPES = ['MySQL', 'PostgreSQL', 'SQL Server', 'Oracle', 'SQLite'];
const ENCODINGS = ['UTF-8', 'GBK', 'GB2312', 'ISO-8859-1', 'UTF-16'];

interface ConvertPair {
  sourceValue: string;
  targetValue: string;
}

interface MappingItem {
  key: string;
  fieldName: string;
  label: string;
  sourceField: string;
  required: boolean;
  convertConfig?: ConvertPair[];
}

const defaultMappings: MappingItem[] = [
  { key: '1', fieldName: 'accountId', label: '账户ID', sourceField: '', required: true },
  { key: '2', fieldName: 'accountName', label: '账户名称', sourceField: '', required: false },
  { key: '3', fieldName: 'accountPermission', label: '账户权限', sourceField: '', required: false },
  { key: '4', fieldName: 'createdTime', label: '账户创建时间', sourceField: '', required: false },
  { key: '5', fieldName: 'lastLoginTime', label: '最后登录时间', sourceField: '', required: false },
  { key: '6', fieldName: 'mfaEnabled', label: '是否开启MFA', sourceField: '', required: false },
  { key: '7', fieldName: 'accountStatus', label: '账户状态', sourceField: '', required: false },
];

interface Props {
  open?: boolean;
  editingDataSource?: DataSource | null;
  onClose?: () => void;
  onSuccess?: () => void;
}

/** Convert fieldMappingConfig object back to MappingItem array */
function configToMappings(config: Record<string, any>): MappingItem[] {
  const items: MappingItem[] = [];
  let key = 0;
  for (const [fieldName, value] of Object.entries(config || {})) {
    const sourceField = typeof value === 'string' ? value : (value?.sourceField || '');
    const convertPairs: ConvertPair[] = [];
    if (typeof value === 'object' && value.convert) {
      for (const [sv, tv] of Object.entries(value.convert)) {
        convertPairs.push({ sourceValue: sv, targetValue: String(tv) });
      }
    }
    const def = defaultMappings.find(m => m.fieldName === fieldName);
    items.push({
      key: String(++key),
      fieldName,
      label: def?.label || fieldName,
      sourceField,
      required: def?.required ?? false,
      convertConfig: convertPairs.length > 0 ? convertPairs : undefined,
    });
  }
  return items.length > 0 ? items : [...defaultMappings];
}

/** Build fieldMappingConfig from current mappings state */
function buildFieldMappingConfig(mappings: MappingItem[]): Record<string, any> {
  const config: Record<string, any> = {};
  mappings.filter(m => m.fieldName && m.sourceField).forEach(m => {
    if (m.convertConfig && m.convertConfig.length > 0) {
      const convert: Record<string, any> = {};
      m.convertConfig.forEach(c => { convert[c.sourceValue] = c.targetValue; });
      config[m.fieldName] = { sourceField: m.sourceField, convert };
    } else {
      config[m.fieldName] = m.sourceField;
    }
  });
  return config;
}

export default function DataSourceForm({ open, editingDataSource, onClose, onSuccess }: Props) {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [sourceType, setSourceType] = useState<string>('DATABASE');
  const [mappings, setMappings] = useState<MappingItem[]>([...defaultMappings]);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [dbColumns, setDbColumns] = useState<string[]>([]);
  const [previewingFields, setPreviewingFields] = useState(false);
  const [expandedConverts, setExpandedConverts] = useState<Set<string>>(new Set());

  const inModal = open !== undefined;
  const isEdit = !!editingDataSource;

  // Available source field column names
  const availableColumns = sourceType === 'CSV' ? csvColumns : dbColumns;

  // Pre-fill form when editing
  useEffect(() => {
    if (!isEdit || !editingDataSource || !inModal) return;
    const ds = editingDataSource;
    setSourceType(ds.sourceType);

    // Basic fields
    form.setFieldsValue({
      name: ds.name,
      type: ds.sourceType,
      dbType: ds.connectionConfig?.dbType,
      host: ds.connectionConfig?.host,
      port: ds.connectionConfig?.port,
      database: ds.connectionConfig?.database,
      username: ds.connectionConfig?.username,
      password: ds.connectionConfig?.password,
      table: ds.connectionConfig?.table,
      sql: ds.connectionConfig?.sql,
      delimiter: ds.csvConfig?.delimiter || ',',
      encoding: ds.csvConfig?.encoding || 'UTF-8',
      hasHeader: ds.csvConfig?.hasHeader ?? true,
    });

    // Restore mappings from fieldMappingConfig
    setMappings(configToMappings(ds.fieldMappingConfig || {}));

    // For CSV, try to fetch columns from preview
    if (ds.sourceType === 'CSV' && ds.id) {
      dataSourceApi.preview(ds.id).then((res: any) => {
        if (res.data?.columns) setCsvColumns(res.data.columns);
      }).catch(() => {});
    }
  }, [open, editingDataSource]);

  // Reset on close / open for create
  useEffect(() => {
    if (inModal && !isEdit) {
      form.resetFields();
      setSourceType('DATABASE');
      setMappings([...defaultMappings]);
      setCsvFile(null);
      setCsvColumns([]);
      setDbColumns([]);
      setExpandedConverts(new Set());
    }
  }, [open, editingDataSource]);

  // CSV file selection — parse header
  const handleCsvSelect = (file: File) => {
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
        const firstLine = text.split('\n')[0];
        const cols = firstLine.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        setCsvColumns(cols);
      }
    };
    reader.readAsText(file);
    return false;
  };

  // DB field preview
  const handlePreviewDbFields = async () => {
    try {
      const values = await form.validateFields(['dbType', 'host', 'port', 'database', 'username', 'password']);
      setPreviewingFields(true);
      const res: any = await apiClient.post('/account/data-sources/preview-fields', {
        dbType: values.dbType,
        host: values.host,
        port: values.port,
        database: values.database,
        username: values.username,
        password: values.password,
      });
      setDbColumns(res.data?.columns || []);
      if ((res.data?.columns || []).length > 0) {
        message.success(`检测到 ${res.data.columns.length} 个字段`);
      }
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '获取字段失败'));
    } finally {
      setPreviewingFields(false);
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (sourceType === 'CSV' && !isEdit && !csvFile) {
        message.error('请选择 CSV 文件');
        return;
      }
      setLoading(true);

      const fieldMappingConfig = buildFieldMappingConfig(mappings);

      if (sourceType === 'DATABASE') {
        const payload: any = {
          name: values.name,
          sourceType: 'DATABASE',
          fieldMappingConfig,
          connectionConfig: {
            dbType: values.dbType,
            host: values.host,
            port: values.port,
            database: values.database,
            username: values.username,
            password: values.password,
            table: values.table || undefined,
            sql: values.sql || undefined,
          },
        };
        if (isEdit) {
          await dataSourceApi.update(editingDataSource!.id, payload);
          message.success('数据源已更新');
        } else {
          await dataSourceApi.create(payload);
          message.success('数据源创建成功');
        }
      } else {
        if (isEdit) {
          // Edit CSV source: update metadata (no file re-upload required unless user picks a new file)
          const payload: any = {
            name: values.name,
            sourceType: 'CSV',
            delimiter: values.delimiter || ',',
            encoding: values.encoding || 'UTF-8',
            hasHeader: values.hasHeader ?? true,
            fieldMappingConfig,
          };
          await dataSourceApi.update(editingDataSource!.id, payload);
          message.success('数据源已更新');
        } else {
          const formData = new FormData();
          formData.append('file', csvFile!);
          formData.append('name', values.name);
          formData.append('sourceType', 'CSV');
          formData.append('delimiter', values.delimiter || ',');
          formData.append('encoding', values.encoding || 'UTF-8');
          formData.append('hasHeader', String(values.hasHeader ?? true));
          formData.append('fieldMappingConfig', JSON.stringify(fieldMappingConfig));

          await apiClient.post('/account/data-sources/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          message.success('数据源创建成功');
        }
      }

      if (onSuccess) onSuccess();
      if (inModal) {
        onClose?.();
      } else {
        navigate('/account-audit/data-sources');
      }
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(getApiErrorMessage(err, isEdit ? '更新失败' : '创建失败'));
    } finally {
      setLoading(false);
    }
  };

  const addMapping = () => {
    const newKey = String(Date.now());
    setMappings([...mappings, { key: newKey, fieldName: '', label: '', sourceField: '', required: false }]);
  };

  const removeMapping = (key: string) => {
    setMappings(mappings.filter(m => m.key !== key));
  };

  const updateMapping = (key: string, field: keyof MappingItem, value: any) => {
    setMappings(mappings.map(m => m.key === key ? { ...m, [field]: value } : m));
  };

  // Value conversion helpers
  const toggleConvertExpand = (key: string) => {
    setExpandedConverts(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const addConvertPair = (mappingKey: string) => {
    setMappings(mappings.map(m => {
      if (m.key !== mappingKey) return m;
      const pairs = m.convertConfig || [];
      return { ...m, convertConfig: [...pairs, { sourceValue: '', targetValue: '' }] };
    }));
  };

  const removeConvertPair = (mappingKey: string, pairIdx: number) => {
    setMappings(mappings.map(m => {
      if (m.key !== mappingKey || !m.convertConfig) return m;
      return { ...m, convertConfig: m.convertConfig.filter((_, i) => i !== pairIdx) };
    }));
  };

  const updateConvertPair = (mappingKey: string, pairIdx: number, field: keyof ConvertPair, value: string) => {
    setMappings(mappings.map(m => {
      if (m.key !== mappingKey || !m.convertConfig) return m;
      const pairs = [...m.convertConfig];
      pairs[pairIdx] = { ...pairs[pairIdx], [field]: value };
      return { ...m, convertConfig: pairs };
    }));
  };

  // ============ Form Content ============

  const formContent = (
    <div style={{ maxWidth: inModal ? '100%' : 720 }}>
      <Form form={form} layout="vertical" initialValues={{ type: 'DATABASE', delimiter: ',', encoding: 'UTF-8', hasHeader: true }}>
        {/* Basic Info */}
        <div style={{
          background: 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(20px)',
          borderRadius: 14,
          padding: '20px 24px',
          border: '0.5px solid rgba(0,0,0,0.06)',
          marginBottom: 16,
        }}>
          <Text strong style={{ fontSize: 14, marginBottom: 12, display: 'block' }}>基本信息</Text>
          <Form.Item name="name" label="数据源名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例如：生产环境AD账户" />
          </Form.Item>
          <Form.Item name="type" label="数据源类型">
            <Select
              value={sourceType}
              onChange={v => { setSourceType(v); form.setFieldValue('type', v); }}
              disabled={isEdit}
              options={[
                { value: 'DATABASE', label: '数据库' },
                { value: 'CSV', label: 'CSV 文件' },
              ]}
            />
          </Form.Item>
        </div>

        {/* Connection Config */}
        <div style={{
          background: 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(20px)',
          borderRadius: 14,
          padding: '20px 24px',
          border: '0.5px solid rgba(0,0,0,0.06)',
          marginBottom: 16,
        }}>
          <Text strong style={{ fontSize: 14, marginBottom: 12, display: 'block' }}>
            {sourceType === 'DATABASE' ? '数据库连接' : '文件配置'}
          </Text>

          {sourceType === 'DATABASE' ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <Button size="small" loading={previewingFields} onClick={handlePreviewDbFields}>
                  获取数据库字段
                </Button>
              </div>
              <Form.Item name="dbType" label="数据库类型" rules={[{ required: true }]}>
                <Select placeholder="选择数据库类型" options={DB_TYPES.map(t => ({ value: t, label: t }))} />
              </Form.Item>
              <div style={{ display: 'flex', gap: 12 }}>
                <Form.Item name="host" label="主机地址" rules={[{ required: true }]} style={{ flex: 1 }}>
                  <Input placeholder="localhost" />
                </Form.Item>
                <Form.Item name="port" label="端口" rules={[{ required: true }]} style={{ width: 140 }}>
                  <InputNumber placeholder="3306" style={{ width: '100%' }} />
                </Form.Item>
              </div>
              <Form.Item name="database" label="数据库名" rules={[{ required: true }]}>
                <Input placeholder="accounts_db" />
              </Form.Item>
              <div style={{ display: 'flex', gap: 12 }}>
                <Form.Item name="username" label="用户名" style={{ flex: 1 }}>
                  <Input placeholder="root" />
                </Form.Item>
                <Form.Item name="password" label="密码" style={{ flex: 1 }}>
                  <Input.Password placeholder="••••••" />
                </Form.Item>
              </div>
              <Form.Item name="table" label="查询表名">
                <Input placeholder="不填则默认读取 users 表" />
              </Form.Item>
              <Form.Item name="sql" label="自定义SQL（可选）" extra="优先于表名，如 SELECT * FROM orders WHERE status='active'">
                <Input.TextArea placeholder="自定义查询语句，不填则 SELECT * FROM [表名]" rows={2} />
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item label="选择文件" required={!isEdit}>
                <Upload
                  beforeUpload={(file) => {
                    handleCsvSelect(file);
                    return false;
                  }}
                  onRemove={() => setCsvFile(null)}
                  accept=".csv"
                  maxCount={1}
                  fileList={csvFile ? [{ uid: '-1', name: csvFile.name, status: 'done' as const }] : []}
                >
                  <Button icon={<UploadOutlined />}>{isEdit ? '重新选择' : '选择 CSV 文件'}</Button>
                </Upload>
                {csvFile && <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>已选择: {csvFile.name}</Text>}
                {isEdit && !csvFile && editingDataSource?.csvConfig && (
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                    当前文件已上传（可重新选择）
                  </Text>
                )}
              </Form.Item>
              <div style={{ display: 'flex', gap: 12 }}>
                <Form.Item name="delimiter" label="分隔符" style={{ flex: 1 }}>
                  <Input placeholder="," />
                </Form.Item>
                <Form.Item name="encoding" label="编码" style={{ flex: 1 }}>
                  <Select options={ENCODINGS.map(e => ({ value: e, label: e }))} />
                </Form.Item>
              </div>
              <Form.Item name="hasHeader" label="首行为列名" valuePropName="checked">
                <Select options={[{ value: true, label: '是' }, { value: false, label: '否' }]} />
              </Form.Item>
            </>
          )}
        </div>

        {/* Field Mapping */}
        <div style={{
          background: 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(20px)',
          borderRadius: 14,
          padding: '20px 24px',
          border: '0.5px solid rgba(0,0,0,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Space>
              <Text strong style={{ fontSize: 14 }}>字段映射</Text>
              <Tooltip title="将数据源的列映射到审计系统的标准字段">
                <InfoCircleOutlined style={{ color: '#AEAEB2', fontSize: 13 }} />
              </Tooltip>
            </Space>
            <Button size="small" icon={<PlusOutlined />} onClick={addMapping}>添加字段</Button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, padding: '0 4px', marginBottom: 4 }}>
              <Text type="secondary" style={{ flex: 1, fontSize: 12 }}>标准字段</Text>
              <Text type="secondary" style={{ flex: 1, fontSize: 12 }}>源字段名</Text>
              <Text type="secondary" style={{ width: 48, fontSize: 12 }}>必填</Text>
              <div style={{ width: 72 }} />
            </div>
            {mappings.map(m => {
              const isRequired = m.key === '1';
              const isExpanded = expandedConverts.has(m.key);
              const hasConvert = m.convertConfig && m.convertConfig.length > 0;

              return (
                <div key={m.key} style={{ marginBottom: 4 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {isRequired ? (
                      <Tag style={{ flex: 1, borderRadius: 6, height: 32, display: 'flex', alignItems: 'center' }}>
                        {m.label}
                      </Tag>
                    ) : (
                      <Input
                        placeholder="字段名"
                        value={m.label}
                        onChange={e => updateMapping(m.key, 'label', e.target.value)}
                        style={{ flex: 1 }}
                      />
                    )}
                    <Select
                      showSearch
                      allowClear
                      placeholder="对应的源列名"
                      value={m.sourceField || undefined}
                      onChange={v => updateMapping(m.key, 'sourceField', v || '')}
                      style={{ flex: 1 }}
                      options={availableColumns.map(c => ({ value: c, label: c }))}
                      filterOption={(input, option) =>
                        (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                      }
                    />
                    <Select
                      value={m.required}
                      onChange={v => updateMapping(m.key, 'required', v)}
                      style={{ width: 60 }}
                      options={[{ value: true, label: '是' }, { value: false, label: '否' }]}
                    />
                    <Tooltip title="值转换">
                      <Button
                        size="small"
                        type={hasConvert ? 'primary' : 'default'}
                        ghost={hasConvert}
                        onClick={() => toggleConvertExpand(m.key)}
                        style={{ width: 32, flexShrink: 0, fontSize: 12, padding: 0 }}
                      >
                        {isExpanded ? <DownOutlined /> : <RightOutlined />}
                      </Button>
                    </Tooltip>
                    {!isRequired && (
                      <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeMapping(m.key)}
                        style={{ width: 32, flexShrink: 0 }} />
                    )}
                    {isRequired && <div style={{ width: 32 }} />}
                  </div>

                  {/* Value Conversion Panel */}
                  {isExpanded && (
                    <div style={{
                      marginTop: 6,
                      marginLeft: 8,
                      padding: '8px 12px',
                      background: '#FAFAFA',
                      borderRadius: 8,
                      border: '0.5px solid rgba(0,0,0,0.08)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>值转换配置</Text>
                        <Button size="small" type="link" icon={<PlusOutlined />} onClick={() => addConvertPair(m.key)}
                          style={{ fontSize: 12, padding: 0, height: 20 }}>
                          添加转换
                        </Button>
                      </div>
                      {(m.convertConfig && m.convertConfig.length > 0) ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {m.convertConfig.map((pair, idx) => (
                            <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <Text type="secondary" style={{ fontSize: 12, flexShrink: 0, width: 28 }}>源值</Text>
                              <Input
                                size="small"
                                placeholder="如 1"
                                value={pair.sourceValue}
                                onChange={e => updateConvertPair(m.key, idx, 'sourceValue', e.target.value)}
                                style={{ width: 80 }}
                              />
                              <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>→</Text>
                              <Text type="secondary" style={{ fontSize: 12, flexShrink: 0, width: 42 }}>目标值</Text>
                              <Input
                                size="small"
                                placeholder="如 true"
                                value={pair.targetValue}
                                onChange={e => updateConvertPair(m.key, idx, 'targetValue', e.target.value)}
                                style={{ width: 80 }}
                              />
                              <Button size="small" danger icon={<DeleteOutlined />}
                                onClick={() => removeConvertPair(m.key, idx)}
                                style={{ width: 24, flexShrink: 0, padding: 0 }} />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Text type="secondary" style={{ fontSize: 12 }}>尚未配置值转换，点击"添加转换"开始</Text>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <Button onClick={() => inModal ? onClose?.() : navigate('/account-audit/data-sources')}>取消</Button>
          <Button type="primary" loading={loading} onClick={handleSubmit}>
            {isEdit ? '保存修改' : '创建数据源'}
          </Button>
        </div>
      </Form>
    </div>
  );

  // Modal mode (used from DataSourceList)
  if (inModal) {
    return (
      <Modal
        title={isEdit ? '编辑数据源' : '添加数据源'}
        open={open}
        onCancel={onClose}
        footer={null}
        width={800}
        destroyOnClose
      >
        {formContent}
      </Modal>
    );
  }

  // Full-page mode (used from /data-sources/new route)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/account-audit/data-sources')} type="text" />
        <Title level={3} style={{ fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 24 }}>添加数据源</Title>
      </div>
      {formContent}
    </div>
  );
}
