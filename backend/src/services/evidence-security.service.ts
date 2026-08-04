import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { EvidenceScanStatus, EvidenceStatus, type EvidenceFile } from '../models';

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.csv', '.txt',
  '.docx', '.xlsx', '.xls', '.zip',
]);

const MIME_BY_EXTENSION: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.csv': ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
  '.txt': ['text/plain'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
  '.xls': ['application/vnd.ms-excel', 'application/octet-stream'],
  '.zip': ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
};

export interface EvidenceInspection {
  originalFilename: string;
  sha256: string;
  mimeType: string;
  scanStatus: EvidenceScanStatus;
}

export class EvidenceSecurityError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'EvidenceSecurityError';
    this.code = code;
  }
}

function decodeOriginalFilename(filename: string): string {
  const decoded = Buffer.from(filename, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? filename : decoded;
}

export function sanitizeEvidenceFilename(filename: string): string {
  const basename = path.basename(decodeOriginalFilename(filename))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  if (!basename) throw new EvidenceSecurityError('INVALID_FILENAME', '文件名无效');
  return basename.slice(-255);
}

function hasExecutableSignature(header: Buffer): boolean {
  if (header.length >= 2 && header[0] === 0x4d && header[1] === 0x5a) return true; // PE
  if (header.length >= 4 && header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return true; // ELF
  if (header.length >= 2 && header[0] === 0x23 && header[1] === 0x21) return true; // script shebang
  const magic = header.subarray(0, 4).toString('hex');
  return ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe'].includes(magic); // Mach-O
}

function hasExpectedSignature(extension: string, header: Buffer): boolean {
  if (extension === '.pdf') return header.subarray(0, 5).toString('ascii') === '%PDF-';
  if (extension === '.png') return header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (extension === '.jpg' || extension === '.jpeg') return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (extension === '.gif') return ['GIF87a', 'GIF89a'].includes(header.subarray(0, 6).toString('ascii'));
  if (extension === '.webp') return header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP';
  if (['.zip', '.docx', '.xlsx'].includes(extension)) {
    const magic = header.subarray(0, 4).toString('hex');
    return ['504b0304', '504b0506', '504b0708'].includes(magic);
  }
  if (extension === '.xls') return header.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (extension === '.csv' || extension === '.txt') return !header.includes(0x00);
  return false;
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function inspectEvidenceFile(file: Express.Multer.File): Promise<EvidenceInspection> {
  const originalFilename = sanitizeEvidenceFilename(file.originalname);
  const extension = path.extname(originalFilename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new EvidenceSecurityError('FILE_TYPE_REJECTED', `不支持的证据文件类型: ${extension || '无扩展名'}`);
  }

  const handle = await fs.promises.open(file.path, 'r');
  let header: Buffer;
  try {
    header = Buffer.alloc(8192);
    const result = await handle.read(header, 0, header.length, 0);
    header = header.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }

  if (hasExecutableSignature(header)) {
    throw new EvidenceSecurityError('EXECUTABLE_REJECTED', '证据文件包含可执行内容，已拒绝上传');
  }
  if (!hasExpectedSignature(extension, header)) {
    throw new EvidenceSecurityError('CONTENT_SIGNATURE_MISMATCH', '文件内容与扩展名不一致');
  }

  const normalizedMime = (file.mimetype || 'application/octet-stream').toLowerCase();
  const allowedMimes = MIME_BY_EXTENSION[extension] || [];
  if (normalizedMime !== 'application/octet-stream' && !allowedMimes.includes(normalizedMime)) {
    throw new EvidenceSecurityError('MIME_MISMATCH', '文件扩展名与内容类型不一致');
  }

  return {
    originalFilename,
    sha256: await sha256File(file.path),
    mimeType: allowedMimes[0] || normalizedMime,
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
  delete data.deletedBy;
  return data;
}
