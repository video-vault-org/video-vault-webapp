import { StorageAdapter } from '@/storage/types/StorageAdapter';
import { readdir, readFile, rm, mkdir, stat, writeFile, unlink } from 'fs/promises';
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

  private async deleteDirectory(path: string) {
    await rm(path, { recursive: true });
  }

  private async deleteEmptyDirectory(path: string) {
    const files = await readdir(path);
    if (files.length === 0) {
      await this.deleteDirectory(path);
    }
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

  public async delete(descriptor: string): Promise<boolean> {
    const path = join(this.basePath, descriptor);
    const exists = await this.exists(path);
    if (!exists) {
      return false;
    }
    await unlink(path);
    await this.deleteEmptyDirectory(dirname(path));
    return true;
  }

  public async deleteDir(descriptor: string): Promise<number> {
    const path = join(this.basePath, descriptor);
    const exists = await this.exists(path);
    if (!exists) {
      return 0;
    }
    const count = (await readdir(path)).length;
    await this.deleteDirectory(path);
    return count;
  }
}

export { LocalStorageAdapter };
