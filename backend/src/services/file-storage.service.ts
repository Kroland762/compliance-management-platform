import { createReadStream, promises as fs } from 'fs';
import path from 'path';
import { config } from '../config';

export interface StoredObject {
  storageKey: string;
  size: number;
}

export interface FileStorage {
  put(storageKey: string, data: Buffer): Promise<StoredObject>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  absolutePath(storageKey: string): string;
  createReadStream(storageKey: string): NodeJS.ReadableStream;
}

export interface S3CompatibleStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

class LocalFileStorage implements FileStorage {
  private readonly root = path.resolve(config.upload.dir);

  private safePath(storageKey: string): string {
    const normalized = storageKey.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.includes('..')) throw new Error('非法 storageKey');
    const target = path.resolve(this.root, normalized);
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error('storageKey 越界');
    return target;
  }

  async put(storageKey: string, data: Buffer): Promise<StoredObject> {
    const target = this.safePath(storageKey);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o750 });
    await fs.writeFile(target, data, { mode: 0o640, flag: 'wx' });
    return { storageKey, size: data.length };
  }

  async delete(storageKey: string): Promise<void> {
    await fs.unlink(this.safePath(storageKey)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  async exists(storageKey: string): Promise<boolean> {
    return fs.access(this.safePath(storageKey)).then(() => true, () => false);
  }

  absolutePath(storageKey: string): string {
    return this.safePath(storageKey);
  }

  createReadStream(storageKey: string): NodeJS.ReadableStream {
    return createReadStream(this.safePath(storageKey));
  }
}

function createFileStorage(): FileStorage {
  if (config.storage.driver !== 'local') {
    throw new Error(`FILE_STORAGE_DRIVER=${config.storage.driver} 尚未实现；本版本仅支持 local`);
  }
  return new LocalFileStorage();
}

export const fileStorage: FileStorage = createFileStorage();
