import { StorageAdapter } from '@/storage/types/StorageAdapter';
import { readFile, open, mkdir, stat, writeFile, unlink } from 'fs/promises';
import { dirname, join } from 'path';
import { LocalStorageConf } from '@/storage/types/LocalStorageConf';

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

  public async save(descriptor: string, data: Buffer): Promise<void> {
    const path = join(this.basePath, descriptor);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
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

      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        start >= size ||
        end >= size
      ) {
        throw new RangeError('Invalid byte range');
      }

      const length = end - start + 1;
      const buffer = Buffer.alloc(length);

      let bytesRead = 0;

      while (bytesRead < length) {
        const result = await file.read(
          buffer,
          bytesRead,
          length - bytesRead,
          start + bytesRead
        );

        if (result.bytesRead === 0) {
          throw new Error('Unexpected end of file');
        }

        bytesRead += result.bytesRead;
      }

      return buffer;
    } finally {
      await file.close();
    }
  };

  public async delete(descriptor: string): Promise<boolean> {
    const path = join(this.basePath, descriptor);
    const exists = await this.exists(path);
    if (!exists) {
      return false;
    }
    await unlink(path);
    return true;
  }
}

export { LocalStorageAdapter };
