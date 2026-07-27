import { createHash, randomUUID } from 'crypto';
import path from 'path';
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

export function validateEvidence(file: Express.Multer.File, tenantId: string): {
  originalFilename: string;
  extension: string;
  storageKey: string;
  sha256: string;
} {
  const originalFilename = normalizeOriginalFilename(file.originalname);
  const extension = path.extname(originalFilename).toLowerCase();
  const allowedMimes = MIME_BY_EXTENSION[extension];
  if (!allowedMimes || !allowedMimes.includes(file.mimetype) || !hasValidSignature(extension, file.buffer)) {
    throw new AppError(400, 'VALIDATION_ERROR', '文件扩展名、MIME 类型或文件签名不一致');
  }
  return {
    originalFilename,
    extension,
    storageKey: `${tenantId}/evidence/${randomUUID()}${extension}`,
    sha256: createHash('sha256').update(file.buffer).digest('hex'),
  };
}
