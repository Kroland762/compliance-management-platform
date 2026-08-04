import fs from 'fs/promises';
import path from 'path';
import Papa from 'papaparse';
import type EvidenceFile from '../models/EvidenceFile';

export type PreviewKind = 'image' | 'pdf' | 'csv' | 'unsupported';

export interface CsvPreviewResult {
  columns: string[];
  rows: Record<string, string>[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    truncated: boolean;
  };
  encoding: 'UTF-8' | 'GB18030';
  warnings: string[];
}

const MAX_CSV_PREVIEW_ROWS = 1000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export function getPreviewKind(filename: string, _mimeType = ''): PreviewKind {
  const extension = path.extname(filename).toLowerCase();
  if (IMAGE_CONTENT_TYPES[extension]) return 'image';
  if (extension === '.pdf') return 'pdf';
  if (extension === '.csv') return 'csv';
  return 'unsupported';
}

export function getSafeContentType(filename: string, _mimeType = ''): string | null {
  const extension = path.extname(filename).toLowerCase();
  if (IMAGE_CONTENT_TYPES[extension]) return IMAGE_CONTENT_TYPES[extension];
  if (extension === '.pdf') return 'application/pdf';
  return null;
}

export function decodeCsvBuffer(buffer: Buffer): { text: string; encoding: 'UTF-8' | 'GB18030' } {
  const withoutBom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
    ? buffer.subarray(3)
    : buffer;

  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(withoutBom),
      encoding: 'UTF-8',
    };
  } catch {
    return {
      text: new TextDecoder('gb18030').decode(buffer),
      encoding: 'GB18030',
    };
  }
}

export function parseCsvPreview(
  text: string,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  encoding: 'UTF-8' | 'GB18030' = 'UTF-8',
): CsvPreviewResult {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || DEFAULT_PAGE_SIZE));
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
    preview: MAX_CSV_PREVIEW_ROWS + 2,
  });
  const parsedRows = parsed.data
    .map(row => row.map(cell => String(cell ?? '')))
    .filter(row => row.some(cell => cell.trim() !== ''));

  const firstRow = parsedRows[0] || [];
  const hasHeader = firstRow.length > 0
    && firstRow.every(cell => cell.trim().length > 0)
    && new Set(firstRow.map(cell => cell.trim())).size === firstRow.length;
  const dataRows = hasHeader ? parsedRows.slice(1) : parsedRows;
  const maxColumns = Math.max(firstRow.length, ...dataRows.map(row => row.length), 0);
  const columns = Array.from({ length: maxColumns }, (_, index) => {
    if (hasHeader && firstRow[index]?.trim()) return firstRow[index].trim();
    return `列${index + 1}`;
  });
  const truncated = dataRows.length > MAX_CSV_PREVIEW_ROWS || Boolean(parsed.meta.truncated);
  const limitedRows = dataRows.slice(0, MAX_CSV_PREVIEW_ROWS);
  const start = (safePage - 1) * safePageSize;
  const rows = limitedRows.slice(start, start + safePageSize).map((row) => (
    Object.fromEntries(columns.map((column, index) => [column, row[index] ?? '']))
  ));
  const warnings = parsed.errors.slice(0, 5).map(error => `第 ${error.row != null ? error.row + 1 : '?'} 行：${error.message}`);

  return {
    columns,
    rows,
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total: limitedRows.length,
      truncated,
    },
    encoding,
    warnings,
  };
}

export async function readCsvPreview(
  evidence: EvidenceFile,
  page?: number,
  pageSize?: number,
): Promise<CsvPreviewResult> {
  if (getPreviewKind(evidence.originalFilename, evidence.mimeType) !== 'csv') {
    throw new Error('该文件不是 CSV 格式');
  }
  const buffer = await fs.readFile(path.resolve(evidence.filePath));
  const decoded = decodeCsvBuffer(buffer);
  return parseCsvPreview(decoded.text, page, pageSize, decoded.encoding);
}
