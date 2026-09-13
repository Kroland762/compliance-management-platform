#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import sequelize from './database';
import Tenant from '../models/Tenant';
import EvidenceFile from '../models/EvidenceFile';
import { config } from './index';
import { runWithTenantContext } from '../middlewares/tenant';
import { validateEvidence } from '../services/evidence-security.service';
import { fileStorage } from '../services/file-storage.service';

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const tenantId = option('tenant');
  if (!tenantId) throw new Error('必须提供 --tenant=<tenant_id>');
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new Error('租户不存在');
  const apply = process.argv.includes('--apply');
  const uploadRoot = path.resolve(config.upload.dir);

  await runWithTenantContext({ schema: tenant.schemaName, tenantId: tenant.id }, async () => {
    const rows = await EvidenceFile.findAll({ where: { storageKey: null, status: 'active' } });
    console.table(rows.map((row) => ({
      id: row.id,
      originalFilename: row.originalFilename,
      filePath: row.filePath,
      fileSize: row.fileSize,
    })));
    if (!apply) {
      console.log('ℹ️ 仅生成文件迁移清单；使用 --apply 执行复制和哈希校验');
      return;
    }
    for (const row of rows) {
      if (!row.filePath) throw new Error(`${row.id} 缺少 legacy filePath`);
      const source = path.resolve(row.filePath);
      if (!source.startsWith(`${uploadRoot}${path.sep}`)) throw new Error(`${row.id} 的 filePath 超出 UPLOAD_DIR`);
      const buffer = await fs.readFile(source);
      const validated = validateEvidence({
        originalname: row.originalFilename,
        mimetype: row.mimeType,
        size: buffer.length,
        buffer,
      } as Express.Multer.File, tenant.id);
      await fileStorage.put(validated.storageKey, buffer);
      await row.update({
        storageKey: validated.storageKey,
        sha256: validated.sha256,
        fileSize: buffer.length,
      });
    }
    console.log(`✅ 已复制并校验 ${rows.length} 个文件；legacy 原文件未删除`);
  });
}

main()
  .catch((error) => {
    console.error('❌ legacy 文件迁移失败:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
