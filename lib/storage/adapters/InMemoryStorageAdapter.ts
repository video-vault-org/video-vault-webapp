import { readFile } from 'node:fs/promises';
import { StorageAdapter } from './StorageAdapter';

class InMemoryStorageAdapter implements StorageAdapter {
  private readonly storage: Record<string, Buffer | undefined> = {};

  public constructor() {}

  public async save(tmpFilePath: string, descriptor: string): Promise<void> {
    this.storage[descriptor] = await readFile(tmpFilePath);
  }

  public async read(descriptor: string): Promise<Buffer | null> {
    return this.storage[descriptor] ?? null;
  }

  public async readRange(descriptor: string, from?: number, to?: number): Promise<Buffer | null> {
    const data = this.storage[descriptor];
    if (!data) {
      return null;
    }

    const start = from ?? 0;
    const end = to ?? data.length - 1;

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= data.length) {
      throw new RangeError('Invalid byte range');
    }

    return data.subarray(start, end + 1);
  }

  public async size(descriptor: string): Promise<number | null> {
    return this.storage[descriptor]?.length ?? null;
  }

  public async delete(descriptor: string): Promise<void> {
    delete this.storage[descriptor];
  }
}

export { InMemoryStorageAdapter };
