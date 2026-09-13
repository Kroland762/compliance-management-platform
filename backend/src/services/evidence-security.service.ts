import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { EvidenceScanStatus, EvidenceStatus, type EvidenceFile } from '../models';
import { AppError } from '../utils/http';
import { normalizeOriginalFilename } from '../utils/upload';

const MIME_BY_EXTENSION: Record<string, string[]> = {
  '.csv': ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'],
  '.doc': ['application/msword', 'application/octet-stream'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
  '.gif': ['image/gif'],
  '.jpeg': ['image/jpeg'],
  '.jpg': ['image/jpeg'],
  '.json': ['application/json', 'text/plain'],
  '.pdf': ['application/pdf'],
  '.png': ['image/png'],
  '.txt': ['text/plain'],
  '.webp': ['image/webp'],
  '.xls': ['application/vnd.ms-excel', 'application/octet-stream'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
};

function begins(buffer: Buffer, bytes: number[]): boolean {
  return bytes.every((value, index) => buffer[index] === value);
}

function hasValidSignature(extension: string, buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  if (extension === '.png') return begins(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (extension === '.jpg' || extension === '.jpeg') return begins(buffer, [0xff, 0xd8, 0xff]);
  if (extension === '.gif') return buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
  if (extension === '.pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (extension === '.webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (extension === '.doc' || extension === '.xls') return begins(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (extension === '.docx' || extension === '.xlsx') return begins(buffer, [0x50, 0x4b, 0x03, 0x04]);
  if (extension === '.txt' || extension === '.csv' || extension === '.json') {
    if (buffer.includes(0)) return false;
    if (extension === '.json') {
      try { JSON.parse(buffer.toString('utf8')); } catch { return false; }
    }
    return true;
  }
  return false;
}

function hasExecutableSignature(buffer: Buffer): boolean {
  if (begins(buffer, [0x4d, 0x5a])) return true;
  if (begins(buffer, [0x7f, 0x45, 0x4c, 0x46])) return true;
  if (begins(buffer, [0x23, 0x21])) return true;
  return ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe']
    .includes(buffer.subarray(0, 4).toString('hex'));
}

export interface EvidenceInspection {
  originalFilename: string;
  sha256: string;
  mimeType: string;
  scanStatus: EvidenceScanStatus;
}

export class EvidenceSecurityError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'EvidenceSecurityError';
  }
}

export function sanitizeEvidenceFilename(filename: string): string {
  const sanitized = path.basename(normalizeOriginalFilename(filename))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/_+/g, '_')
    .trim();
  if (!sanitized) throw new EvidenceSecurityError('INVALID_FILENAME', '文件名无效');
  return sanitized.slice(-255);
}

async function readEvidenceBuffer(file: Express.Multer.File): Promise<Buffer> {
  if (file.buffer?.length) return file.buffer;
  if (file.path) return fs.promises.readFile(file.path);
  throw new EvidenceSecurityError('FILE_UNAVAILABLE', '无法读取上传文件');
}

export async function inspectEvidenceFile(file: Express.Multer.File): Promise<EvidenceInspection> {
  const originalFilename = sanitizeEvidenceFilename(file.originalname);
  const extension = path.extname(originalFilename).toLowerCase();
  const allowedMimes = MIME_BY_EXTENSION[extension];
  if (!allowedMimes) {
    throw new EvidenceSecurityError('FILE_TYPE_REJECTED', `不支持的证据文件类型: ${extension || '无扩展名'}`);
  }

  const buffer = await readEvidenceBuffer(file);
  const header = buffer.subarray(0, 8192);
  if (hasExecutableSignature(header)) {
    throw new EvidenceSecurityError('EXECUTABLE_REJECTED', '证据文件包含可执行内容，已拒绝上传');
  }
  if (!hasValidSignature(extension, header)) {
    throw new EvidenceSecurityError('CONTENT_SIGNATURE_MISMATCH', '文件内容与扩展名不一致');
  }
  const mimeType = (file.mimetype || 'application/octet-stream').toLowerCase();
  if (mimeType !== 'application/octet-stream' && !allowedMimes.includes(mimeType)) {
    throw new EvidenceSecurityError('MIME_MISMATCH', '文件扩展名与内容类型不一致');
  }

  return {
    originalFilename,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    mimeType: allowedMimes[0] || mimeType,
    scanStatus: EvidenceScanStatus.CLEAN,
  };
}

export function assertEvidenceReadable(evidence: EvidenceFile): void {
  if (evidence.status !== EvidenceStatus.ACTIVE) {
    throw new EvidenceSecurityError('EVIDENCE_UNAVAILABLE', '证据文件已删除或被隔离');
  }
  if (evidence.scanStatus !== EvidenceScanStatus.CLEAN) {
    throw new EvidenceSecurityError('EVIDENCE_NOT_CLEAN', '证据文件尚未通过安全检查');
  }
}

export function serializeEvidence(evidence: EvidenceFile | Record<string, any>): Record<string, any> {
  const data = typeof (evidence as EvidenceFile).toJSON === 'function'
    ? (evidence as EvidenceFile).toJSON()
    : { ...evidence };
  delete data.filePath;
  delete data.storedFilename;
  delete data.storageKey;
  delete data.deletedBy;
  return data;
}

export function validateEvidence(file: Express.Multer.File, tenantId: string): {
  originalFilename: string;
  extension: string;
  storageKey: string;
  sha256: string;
} {
  const originalFilename = normalizeOriginalFilename(file.originalname);
  const extension = path.extname(originalFilename).toLowerCase();
  const allowedMimes = MIME_BY_EXTENSION[extension];
  if (
    !allowedMimes
    || !allowedMimes.includes(file.mimetype)
    || hasExecutableSignature(file.buffer)
    || !hasValidSignature(extension, file.buffer)
  ) {
    throw new AppError(400, 'VALIDATION_ERROR', '文件扩展名、MIME 类型或文件签名不一致');
  }
  return {
    originalFilename,
    extension,
    storageKey: `${tenantId}/evidence/${randomUUID()}${extension}`,
    sha256: createHash('sha256').update(file.buffer).digest('hex'),
  };
}
