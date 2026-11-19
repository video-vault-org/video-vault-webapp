import { StorageAdapter } from './StorageAdapter';
import { readFile, open, mkdir, stat, copyFile, unlink } from 'fs/promises';
import { join } from 'path';
import { LocalStorageConf } from '@/storage/config/LocalStorageConf';

/**
 * Storage Adapter for local file system
 */
class LocalStorageAdapter implements StorageAdapter {
  private readonly basePath: string;

  /**
   * Constructor
   * @param basePath the local file system path where to store the files
   */
  public constructor({ basePath }: LocalStorageConf) {
    this.basePath = basePath;
  }

  public getBasePath(): string {
    return this.basePath;
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  public async save(tmpFilePath: string, descriptor: string): Promise<void> {
    const targetPath = join(this.basePath, descriptor);
    await mkdir(this.basePath, { recursive: true });
    await copyFile(tmpFilePath, targetPath);
  }

  public async read(descriptor: string): Promise<Buffer | null> {
    const path = join(this.basePath, descriptor);
    const exists = await this.exists(path);
    if (!exists) {
      return null;
    }
    return await readFile(path);
  }

  public async readRange(descriptor: string, from?: number, to?: number): Promise<Buffer | null> {
    const path = join(this.basePath, descriptor);

    const file = await open(path, 'r').catch((err) => {
      if (err.code === 'ENOENT') return null;
      throw err;
    });

    if (!file) return null;

    try {
      const { size } = await file.stat();

      const start = from ?? 0;
      const end = to ?? size - 1;

      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size || end >= size) {
        throw new RangeError('Invalid byte range');
      }

      const length = end - start + 1;
      const buffer = Buffer.alloc(length);

      let bytesRead = 0;

      while (bytesRead < length) {
        const result = await file.read(buffer, bytesRead, length - bytesRead, start + bytesRead);

        if (result.bytesRead === 0) {
          throw new Error('Unexpected end of file');
        }

        bytesRead += result.bytesRead;
      }

      return buffer;
    } finally {
      await file.close();
    }
  }

  public async delete(descriptor: string): Promise<void> {
    try {
      await unlink(join(this.basePath, descriptor));
    } catch (error: unknown) {
      if ((error as Record<string, unknown>)?.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

export { LocalStorageAdapter };
