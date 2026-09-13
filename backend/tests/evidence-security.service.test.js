import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  inspectEvidenceFile,
  sanitizeEvidenceFilename,
  serializeEvidence,
} from '../src/services/evidence-security.service';
import { EvidenceScanStatus } from '../src/models';

const tempPaths = [];

function tempFile(name, content, mimetype) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-security-'));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  tempPaths.push(dir);
  return { path: filePath, originalname: name, mimetype, size: Buffer.byteLength(content) };
}

describe('evidence security service', () => {
  afterEach(() => {
    tempPaths.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
  });

  test('computes SHA-256 and accepts an allowed non-executable document', async () => {
    const file = tempFile('proof.pdf', '%PDF-1.7\ncompliance evidence', 'application/pdf');
    const result = await inspectEvidenceFile(file);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.scanStatus).toBe(EvidenceScanStatus.CLEAN);
    expect(result.originalFilename).toBe('proof.pdf');
  });

  test('rejects executable content even when the extension is allowed', async () => {
    const file = tempFile('proof.pdf', Buffer.from([0x4d, 0x5a, 0x90, 0x00]), 'application/pdf');
    await expect(inspectEvidenceFile(file)).rejects.toMatchObject({ code: 'EXECUTABLE_REJECTED' });
  });

  test('removes storage paths from API responses', () => {
    const serialized = serializeEvidence({
      id: 'evidence-1', filePath: '/secret/path', storedFilename: 'opaque', deletedBy: 'user-1', sha256: 'abc',
    });
    expect(serialized).not.toHaveProperty('filePath');
    expect(serialized).not.toHaveProperty('storedFilename');
    expect(serialized).not.toHaveProperty('deletedBy');
    expect(serialized.sha256).toBe('abc');
  });

  test('normalizes path separators and control characters in filenames', () => {
    expect(sanitizeEvidenceFilename('../bad\u0000:name.pdf')).toBe('bad_name.pdf');
  });
});
