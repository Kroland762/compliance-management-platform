import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Descriptions, Modal, Select, Space, Table, Tag, Typography, Upload, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { dataSourceApi, type CsvPreview, type DataSource } from '../../api/account';
import { getApiErrorMessage } from '../../utils/error';

const { Text } = Typography;
const STANDARD_FIELDS = [
  ['accountId', '账户ID'],
  ['accountName', '账户名称'],
  ['accountPermission', '账户权限'],
  ['createdTime', '账户创建时间'],
  ['lastLoginTime', '最后登录时间'],
  ['mfaEnabled', '是否开启MFA'],
  ['accountStatus', '账户状态'],
] as const;

interface Props {
  open: boolean;
  source: DataSource | null;
  onClose: () => void;
  onSuccess: () => void;
}

function mappingSource(value: any): string {
  return typeof value === 'string' ? value : String(value?.sourceField || '');
}

function mappingSignature(mapping: Record<string, any>) {
  return JSON.stringify(mapping);
}

export default function CsvReuploadModal({ open, source, onClose, onSuccess }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, any>>({});
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [previewedSignature, setPreviewedSignature] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setPreview(null);
    setPreviewedSignature('');
    setMapping({ ...(source?.fieldMappingConfig || {}) });
  }, [open, source?.id]);

  const mappingRows = useMemo(() => {
    const labels = new Map<string, string>(STANDARD_FIELDS);
    const keys = [...new Set([...STANDARD_FIELDS.map(([key]) => key), ...Object.keys(mapping)])];
    return keys.map(key => ({ key, label: labels.get(key) || key, sourceField: mappingSource(mapping[key]) }));
  }, [mapping]);

  const updateSourceField = (key: string, value?: string) => {
    setMapping(previous => {
      const next = { ...previous };
      const current = previous[key];
      if (!value) delete next[key];
      else if (current && typeof current === 'object') next[key] = { ...current, sourceField: value };
      else next[key] = value;
      return next;
    });
  };

  const runPreview = async (selectedFile = file, selectedMapping = mapping) => {
    if (!selectedFile || !source) return;
    setPreviewing(true);
    try {
      const response: any = await dataSourceApi.previewCsv(selectedFile, {
        sourceId: source.id,
        fieldMappingConfig: selectedMapping,
      });
      setPreview(response.data);
      setPreviewedSignature(mappingSignature(selectedMapping));
    } catch (error: any) {
      setPreview(null);
      message.error(getApiErrorMessage(error, 'CSV 预览失败'));
    } finally {
      setPreviewing(false);
    }
  };

  const handleFile = (selected: File) => {
    setFile(selected);
    void runPreview(selected, mapping);
    return false;
  };

  const currentSignature = mappingSignature(mapping);
  const previewIsCurrent = Boolean(preview) && previewedSignature === currentSignature;
  const importReady = previewIsCurrent
    && preview?.compatibility.status === 'COMPATIBLE'
    && preview.warnings.blankAccountRows.length === 0;

  const handleImport = async () => {
    if (!file || !source || !preview || !importReady) return;
    setImporting(true);
    try {
      const response: any = await dataSourceApi.reuploadCsv(source.id, file, {
        fieldMappingConfig: mapping,
        expectedSha256: preview.file.sha256,
        delimiter: preview.file.delimiter,
      });
      message.success(response.data?.skipped ? response.data.reason : `导入完成，共 ${response.data?.imported || 0} 条`);
      onSuccess();
      onClose();
    } catch (error: any) {
      message.error(getApiErrorMessage(error, 'CSV 导入失败'));
    } finally {
      setImporting(false);
    }
  };

  const sampleRows = preview?.sampleRows.length ? preview.sampleRows : preview?.rawSampleRows || [];
  const sampleColumns = Object.keys(sampleRows[0] || {}).slice(0, 7).map(key => ({
    title: key,
    dataIndex: key,
    ellipsis: true,
    render: (value: any) => value === null || value === undefined ? '-' : String(value),
  }));

  return (
    <Modal
      title={`重新上传 CSV${source ? ` · ${source.name}` : ''}`}
      open={open}
      onCancel={onClose}
      onOk={handleImport}
      okText="确认导入"
      okButtonProps={{ disabled: !importReady }}
      confirmLoading={importing}
      width={900}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        message="文件仅用于本次预览和导入，不会保存原始 CSV；确认后继续使用当前系统 ID 和映射。"
        style={{ marginBottom: 16 }}
      />
      <Upload
        accept=".csv"
        maxCount={1}
        beforeUpload={handleFile}
        onRemove={() => { setFile(null); setPreview(null); setPreviewedSignature(''); }}
        fileList={file ? [{ uid: '-1', name: file.name, status: 'done' }] : []}
      >
        <Button icon={<UploadOutlined />} loading={previewing}>选择 CSV 文件</Button>
      </Upload>

      {preview && (
        <>
          <Descriptions size="small" bordered column={4} style={{ marginTop: 16 }}>
            <Descriptions.Item label="行数">{preview.rowCount}</Descriptions.Item>
            <Descriptions.Item label="编码">{preview.file.encoding}</Descriptions.Item>
            <Descriptions.Item label="新增">{preview.changeSummary.newCount}</Descriptions.Item>
            <Descriptions.Item label="减少">{preview.changeSummary.reducedCount}</Descriptions.Item>
          </Descriptions>

          <Space style={{ marginTop: 16, marginBottom: 8 }}>
            <Text strong>字段映射</Text>
            <Tag color={preview.compatibility.status === 'COMPATIBLE' ? 'green' : 'orange'}>
              {preview.compatibility.status === 'COMPATIBLE' ? '映射兼容' : '需要调整'}
            </Tag>
            {!previewIsCurrent && <Tag color="gold">映射已修改，请重新校验</Tag>}
          </Space>
          {preview.compatibility.missingSourceFields.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message={`缺少原字段：${preview.compatibility.missingSourceFields.join('、')}`}
              style={{ marginBottom: 8 }}
            />
          )}
          {preview.warnings.blankAccountRows.length > 0 && (
            <Alert type="error" showIcon message={`账户 ID 为空：第 ${preview.warnings.blankAccountRows.join('、')} 行`} style={{ marginBottom: 8 }} />
          )}
          {preview.warnings.duplicateAccountCount > 0 && (
            <Alert type="warning" showIcon message={`检测到 ${preview.warnings.duplicateAccountCount} 个重复账户 ID，将保留原始行`} style={{ marginBottom: 8 }} />
          )}
          <Table
            size="small"
            pagination={false}
            rowKey="key"
            dataSource={mappingRows}
            columns={[
              { title: '标准字段', dataIndex: 'label', width: 180 },
              {
                title: 'CSV 源字段',
                dataIndex: 'sourceField',
                render: (value: string, row) => (
                  <Select
                    data-testid={`reupload-mapping-${row.key}`}
                    showSearch
                    allowClear
                    value={value || undefined}
                    options={preview.headers.map(header => ({ label: header, value: header }))}
                    onChange={next => updateSourceField(row.key, next)}
                    style={{ width: '100%' }}
                  />
                ),
              },
            ]}
          />
          <Button onClick={() => runPreview()} loading={previewing} disabled={previewIsCurrent} style={{ marginTop: 8 }}>
            重新校验映射
          </Button>

          <Text strong style={{ display: 'block', marginTop: 16, marginBottom: 8 }}>导入样例</Text>
          <Table
            size="small"
            pagination={false}
            rowKey={(_, index) => String(index)}
            dataSource={sampleRows}
            columns={sampleColumns}
            scroll={{ x: 700 }}
          />
        </>
      )}
    </Modal>
  );
}
