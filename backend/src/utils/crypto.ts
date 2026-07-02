import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const isProd = process.env.NODE_ENV === 'production';
const rawKey = process.env.ENCRYPTION_KEY || (isProd ? '' : 'audit-platform-field-encryption-key-2026');
const INSECURE_ENCRYPTION_KEYS = new Set([
  'change-this-to-another-random-string',
  'audit-platform-field-encryption-key-2026',
]);
if (isProd && (!process.env.ENCRYPTION_KEY || INSECURE_ENCRYPTION_KEYS.has(process.env.ENCRYPTION_KEY))) {
  throw new Error('❌ 生产环境必须设置非占位 ENCRYPTION_KEY 环境变量');
}
const KEY = crypto.scryptSync(rawKey, 'salt', 32);
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * 加密敏感字段
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * 解密敏感字段
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext || !ciphertext.includes(':')) return ciphertext;
  const parts = ciphertext.split(':');
  if (parts.length !== 3) return ciphertext;
  const [ivHex, tagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
