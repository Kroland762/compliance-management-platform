import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const isProd = process.env.NODE_ENV === 'production';
const rawKey = process.env.ENCRYPTION_KEY || (isProd ? '' : 'audit-platform-field-encryption-key-2026');
const INSECURE_ENCRYPTION_KEYS = new Set([
  'change-this-to-another-random-string',
  'change-me-to-another-random-64-char-string',
  'audit-platform-field-encryption-key-2026',
]);
if (isProd && (!process.env.ENCRYPTION_KEY || INSECURE_ENCRYPTION_KEYS.has(process.env.ENCRYPTION_KEY))) {
  throw new Error('❌ 生产环境必须设置非占位 ENCRYPTION_KEY 环境变量');
}
if (isProd && rawKey.length < 32) {
  throw new Error('❌ ENCRYPTION_KEY 长度至少为32字符');
}
const ACTIVE_KEY_ID = process.env.ENCRYPTION_KEY_ID || 'primary';
const configuredKeyring = (() => {
  try { return JSON.parse(process.env.ENCRYPTION_KEYRING || '{}') as Record<string, string>; }
  catch { throw new Error('❌ ENCRYPTION_KEYRING 必须是 keyId 到密钥的 JSON 对象'); }
})();
const keyring: Record<string, string> = { ...configuredKeyring, [ACTIVE_KEY_ID]: rawKey };
const IV_LENGTH = 16;

function deriveKey(secret: string): Buffer {
  return crypto.scryptSync(secret, 'compliance-platform:field-encryption:v2', 32);
}

function legacyKey(): Buffer {
  return crypto.scryptSync(rawKey, 'salt', 32);
}

/**
 * 加密敏感字段
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(keyring[ACTIVE_KEY_ID]), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  // Format: v2:keyId:iv:tag:ciphertext (binary fields are hex)
  return `v2:${ACTIVE_KEY_ID}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * 解密敏感字段
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext || !ciphertext.includes(':')) return ciphertext;
  const parts = ciphertext.split(':');
  if (parts.length === 5 && parts[0] === 'v2') {
    const [, keyId, ivHex, tagHex, encrypted] = parts;
    const secret = keyring[keyId];
    if (!secret) throw new Error(`未配置加密密钥: ${keyId}`);
    return decryptWithKey(ivHex, tagHex, encrypted, deriveKey(secret));
  }
  if (parts.length !== 3) return ciphertext;
  const [ivHex, tagHex, encrypted] = parts;
  return decryptWithKey(ivHex, tagHex, encrypted, legacyKey());
}

function decryptWithKey(ivHex: string, tagHex: string, encrypted: string, key: Buffer): string {
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function isEncryptedValue(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return /^v2:[A-Za-z0-9_.-]+:[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/i.test(value)
    || /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/i.test(value);
}
