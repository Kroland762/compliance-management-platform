import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Modal, Result, Space, Spin, Table, Tooltip, Typography, message } from 'antd';
import {
  DownloadOutlined,
  FullscreenOutlined,
  RedoOutlined,
  ReloadOutlined,
  RotateLeftOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import apiClient from '../api/client';

const { Text } = Typography;

export interface PreviewableEvidenceFile {
  id: string;
  originalFilename: string;
  mimeType?: string;
  fileSize?: number;
  evidenceType?: 'current' | 'historical';
}

interface CsvPreviewData {
  columns: string[];
  rows: Record<string, string>[];
  pagination: { page: number; pageSize: number; total: number; truncated: boolean };
  encoding: string;
  warnings?: string[];
}

type PreviewKind = 'image' | 'pdf' | 'csv' | 'unsupported';

function previewKind(file: PreviewableEvidenceFile): PreviewKind {
  const extension = file.originalFilename.split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension || '')) return 'image';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'csv') return 'csv';
  return 'unsupported';
}

function formatFileSize(size?: number): string {
  if (size == null) return '大小未知';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatFileType(file: PreviewableEvidenceFile): string {
  const extension = file.originalFilename.split('.').pop()?.toUpperCase();
  return extension && extension !== file.originalFilename.toUpperCase() ? extension : '未知类型';
}

export async function downloadEvidenceFile(file: PreviewableEvidenceFile): Promise<void> {
  try {
    const blob = await apiClient.get(`/evidence/${file.id}/download`, { responseType: 'blob' }) as unknown as Blob;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.originalFilename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    message.error('文件下载失败，请稍后重试');
  }
}

export default function FilePreviewModal({
  file,
  open,
  onClose,
}: {
  file: PreviewableEvidenceFile | null;
  open: boolean;
  onClose: () => void;
}) {
  const kind = file ? previewKind(file) : 'unsupported';
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [objectUrl, setObjectUrl] = useState('');
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [csvData, setCsvData] = useState<CsvPreviewData | null>(null);
  const [csvPage, setCsvPage] = useState(1);

  const releaseObjectUrl = () => {
    setObjectUrl(current => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });
  };

  const loadBinary = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    setLoadProgress(null);
    releaseObjectUrl();
    try {
      const blob = await apiClient.get(`/evidence/${file.id}/content`, {
        responseType: 'blob',
        onDownloadProgress: (event) => {
          if (event.total) setLoadProgress(Math.round((event.loaded / event.total) * 100));
        },
      }) as unknown as Blob;
      setObjectUrl(URL.createObjectURL(blob));
    } catch {
      setError('文件加载失败，文件可能已被移除或内容已损坏。');
    } finally {
      setLoading(false);
    }
  };

  const loadCsv = async (page: number) => {
    if (!file) return;
    setLoading(true);
    setError('');
    setLoadProgress(null);
    try {
      const response: any = await apiClient.get(`/evidence/${file.id}/preview`, {
        params: { page, pageSize: 50 },
      });
      setCsvData(response.data);
      setCsvPage(page);
    } catch {
      setError('CSV 解析失败，可能是编码、列结构或文件内容异常。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !file) return;
    setScale(1);
    setRotation(0);
    setCsvData(null);
    setCsvPage(1);
    setError('');
    if (kind === 'csv') loadCsv(1);
    else if (kind === 'image' || kind === 'pdf') loadBinary();
    return releaseObjectUrl;
    // file.id is the stable identity for preview reloads.
  }, [open, file?.id]);

  const csvColumns = useMemo(() => (csvData?.columns || []).map((column, index) => ({
    title: column,
    dataIndex: column,
    key: `${column}-${index}`,
    width: 180,
    ellipsis: { showTitle: false },
    render: (value: string) => (
      <Tooltip title={value || undefined}>
        <span>{value}</span>
      </Tooltip>
    ),
  })), [csvData?.columns]);

  const retry = () => {
    if (kind === 'csv') loadCsv(csvPage);
    else loadBinary();
  };

  const renderPreview = () => {
    if (kind === 'unsupported') {
      return <Result status="info" title="该格式暂不支持在线预览" subTitle="您仍可以下载原文件后查看。" />;
    }
    if (loading && !objectUrl && !csvData) {
      return (
        <div style={{ minHeight: 360, display: 'grid', placeItems: 'center' }}>
          <Space direction="vertical" align="center">
            <Spin size="large" />
            <Text type="secondary">正在加载文件{loadProgress != null ? ` ${loadProgress}%` : '…'}</Text>
          </Space>
        </div>
      );
    }
    if (error) {
      return <Result status="warning" title="无法预览" subTitle={error} extra={<Button icon={<ReloadOutlined />} onClick={retry}>重试</Button>} />;
    }
    if (kind === 'image' && objectUrl) {
      return (
        <div ref={previewContainerRef} style={{ background: '#f5f5f7', minHeight: 520, overflow: 'auto', display: 'grid', placeItems: 'center', padding: 24 }}>
          <img
            src={objectUrl}
            alt={file?.originalFilename || '证据图片'}
            style={{ maxWidth: '100%', maxHeight: '65vh', transform: `scale(${scale}) rotate(${rotation}deg)`, transition: 'transform 160ms ease' }}
          />
        </div>
      );
    }
    if (kind === 'pdf' && objectUrl) {
      return <iframe title={file?.originalFilename || 'PDF 预览'} src={objectUrl} style={{ width: '100%', height: '72vh', border: 0, background: '#f5f5f7' }} />;
    }
    if (kind === 'csv' && csvData) {
      return (
        <div>
          {csvData.pagination.truncated && (
            <Alert type="info" showIcon message="当前展示前 1000 行，完整内容请下载查看" style={{ marginBottom: 12 }} />
          )}
          {Boolean(csvData.warnings?.length) && (
            <Alert type="warning" showIcon message="部分行存在格式异常" description={csvData.warnings?.join('；')} style={{ marginBottom: 12 }} />
          )}
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>编码：{csvData.encoding}</Text>
          <Table
            size="small"
            bordered
            rowKey={(_, index) => `${csvPage}-${index}`}
            columns={csvColumns}
            dataSource={csvData.rows}
            scroll={{ x: 'max-content', y: 480 }}
            pagination={{
              current: csvData.pagination.page,
              pageSize: csvData.pagination.pageSize,
              total: csvData.pagination.total,
              showSizeChanger: false,
              onChange: loadCsv,
              showTotal: total => `预览 ${total} 行`,
            }}
          />
        </div>
      );
    }
    return null;
  };

  const imageTools = kind === 'image' ? (
    <Space>
      <Button icon={<ZoomOutOutlined />} onClick={() => setScale(value => Math.max(0.25, value - 0.25))}>缩小</Button>
      <Button icon={<ZoomInOutlined />} onClick={() => setScale(value => Math.min(4, value + 0.25))}>放大</Button>
      <Button icon={<RotateLeftOutlined />} onClick={() => setRotation(value => value - 90)}>旋转</Button>
      <Button icon={<RedoOutlined />} onClick={() => { setScale(1); setRotation(0); }}>复位</Button>
      <Button icon={<FullscreenOutlined />} onClick={() => previewContainerRef.current?.requestFullscreen?.()}>全屏</Button>
    </Space>
  ) : null;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width="92vw"
      style={{ top: 24 }}
      title={file ? (
        <div>
          <div style={{ fontWeight: 600 }}>{file.originalFilename}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{formatFileType(file)} · {formatFileSize(file.fileSize)}</Text>
        </div>
      ) : '文件预览'}
      footer={(
        <div style={{ display: 'flex', justifyContent: imageTools ? 'space-between' : 'flex-end', alignItems: 'center' }}>
          {imageTools}
          <Space>
            <Button icon={<DownloadOutlined />} disabled={!file} onClick={() => file && downloadEvidenceFile(file)}>下载原文件</Button>
            <Button type="primary" onClick={onClose}>关闭</Button>
          </Space>
        </div>
      )}
      destroyOnClose
    >
      {renderPreview()}
    </Modal>
  );
}
