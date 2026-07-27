import path from 'path';

const DANGEROUS_EXTENSIONS = new Set([
  '.app', '.bat', '.bin', '.cmd', '.com', '.dll', '.dmg', '.exe', '.js', '.jse',
  '.msi', '.ps1', '.scr', '.sh', '.vbe', '.vbs', '.wsf',
]);

export function normalizeOriginalFilename(originalName: string): string {
  const decoded = Buffer.from(originalName || 'upload', 'latin1').toString('utf8');
  const base = path.basename(decoded).replace(/[^\w.\-\u4e00-\u9fa5 ]/g, '_').trim();
  return base || 'upload';
}

export function hasAllowedExtension(originalName: string, allowedExtensions: string[]): boolean {
  const ext = path.extname(normalizeOriginalFilename(originalName)).toLowerCase();
  return allowedExtensions.includes(ext) && !DANGEROUS_EXTENSIONS.has(ext);
}

export function isAllowedEvidenceFile(file: Express.Multer.File): boolean {
  const allowedExtensions = [
    '.csv', '.doc', '.docx', '.gif', '.jpeg', '.jpg', '.json', '.pdf', '.png',
    '.txt', '.webp', '.xls', '.xlsx',
  ];
  if (!hasAllowedExtension(file.originalname, allowedExtensions)) return false;

  const allowedMimePrefixes = ['image/'];
  const allowedMimeTypes = new Set([
    'application/json',
    'application/msword',
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/csv',
    'text/plain',
  ]);

  return allowedMimeTypes.has(file.mimetype) || allowedMimePrefixes.some((prefix) => file.mimetype.startsWith(prefix));
}

export function isAllowedCsvFile(file: Express.Multer.File): boolean {
  return hasAllowedExtension(file.originalname, ['.csv']) && (
    file.mimetype === 'text/csv'
    || file.mimetype === 'application/csv'
    || file.mimetype === 'application/vnd.ms-excel'
    || file.mimetype === 'text/plain'
  );
}
