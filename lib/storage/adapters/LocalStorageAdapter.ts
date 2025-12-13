import { StorageAdapter } from '@/storage/types/StorageAdapter';
import { readdir, readFile, rm, mkdir, writeFile, unlink } from 'fs/promises';
import { dirname, join } from 'path';
import { FsError } from '@/storage/types/FsError';

/**
 * Storage Adapter for local file system
 */
class LocalStorageAdapter implements StorageAdapter {
  private readonly basePath: string;

  /**
   * Constructor
   * @param basePath the local file system path where to store the files
   */
  public constructor(basePath: string) {
    this.basePath = basePath;
  }

  public getBasePath(): string {
    return this.basePath;
  }

  private async deleteEmptyDirectory(path: string) {
    const files = await readdir(path);
    if (files.length === 0) {
      await rm(path, { recursive: true });
    }
  }

  private handleError(descriptor: string, err: unknown): Error {
    const error = err as FsError;
    if (error.code === 'ENOENT') {
      return Error(`Error: file does not exist: ${descriptor}`);
    }
    return error as Error;
  }

  public async save(descriptor: string, data: Buffer): Promise<void> {
    const path = join(this.basePath, descriptor);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  public async read(descriptor: string): Promise<Buffer> {
    const path = join(this.basePath, descriptor);
    try {
      return await readFile(path);
    } catch (err: unknown) {
      throw this.handleError(descriptor, err);
    }
  }

  public async delete(descriptor: string): Promise<void> {
    const path = join(this.basePath, descriptor);
    try {
      await unlink(path);
      await this.deleteEmptyDirectory(dirname(path));
    } catch (err: unknown) {
      throw this.handleError(descriptor, err);
    }
  }
}

export { LocalStorageAdapter };
