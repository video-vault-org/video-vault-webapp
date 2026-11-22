import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageAdapter } from '@/storage/adapters/LocalStorageAdapter';

describe('LocalStorageAdapter', () => {
  const descriptor = 'clip.bin';
  const bytes = Buffer.from([0, 127, 128, 255, 42]);
  let directory: string;
  let adapter: LocalStorageAdapter;

  async function save(descriptor: string, data: Buffer): Promise<void> {
    const source = join(directory, 'upload.tmp');
    await writeFile(source, data);
    await adapter.save(source, descriptor);
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'video-vault-storage-'));
    adapter = new LocalStorageAdapter({ basePath: directory });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test('size distinguishes absent, empty, saved and deleted objects without reading contents', async () => {
    expect(await adapter.size(descriptor)).toBeNull();
    await save(descriptor, Buffer.alloc(0));
    expect(await adapter.size(descriptor)).toBe(0);
    await save(descriptor, bytes);
    const read = jest.spyOn(adapter, 'read');
    expect(await adapter.size(descriptor)).toBe(bytes.length);
    expect(read).not.toHaveBeenCalled();
    await adapter.delete(descriptor);
    expect(await adapter.size(descriptor)).toBeNull();
  });

  test('getBasePath returns the configured path', () => {
    expect(adapter.getBasePath()).toBe(directory);
  });

  test('save copies to the base directory and overwrites an existing file', async () => {
    const path = join(directory, descriptor);
    await save(descriptor, bytes);
    expect(await readFile(path)).toEqual(bytes);

    await save(descriptor, Buffer.from([255]));
    expect(await readFile(path)).toEqual(Buffer.from([255]));
  });

  test('save creates the storage directory and preserves the source file after copying it', async () => {
    const source = join(directory, 'upload.tmp');
    const target = join(directory, 'new', 'storage');
    const storage = new LocalStorageAdapter({ basePath: target });
    await writeFile(source, bytes);

    await expect(storage.save(source, descriptor)).resolves.toBeUndefined();

    expect(await readFile(join(target, descriptor))).toEqual(bytes);
    expect(await readFile(source)).toEqual(bytes);
  });

  test('save rejects a missing source without changing the existing file', async () => {
    await save(descriptor, bytes);

    await expect(adapter.save(join(directory, 'missing.tmp'), descriptor)).rejects.toMatchObject({ code: 'ENOENT' });

    expect(await adapter.read(descriptor)).toEqual(bytes);
  });

  test('read returns the exact file bytes', async () => {
    await writeFile(join(directory, 'existing.bin'), bytes);

    expect(await adapter.read('existing.bin')).toEqual(bytes);
  });

  test('read returns null for a missing file and a buffer for an empty file', async () => {
    await save('empty.bin', Buffer.alloc(0));

    expect(await adapter.read('missing.bin')).toBeNull();
    expect(await adapter.read('empty.bin')).toEqual(Buffer.alloc(0));
  });

  test.each([
    [1, 3, bytes.subarray(1, 4)],
    [2, 2, bytes.subarray(2, 3)],
    [2, undefined, bytes.subarray(2)],
    [undefined, 0, bytes.subarray(0, 1)],
    [undefined, undefined, bytes]
  ])('readRange returns inclusive bytes from %s to %s', async (from, to, expected) => {
    await save(descriptor, bytes);

    expect(await adapter.readRange(descriptor, from, to)).toEqual(expected);
  });

  test.each([
    [-1, 2],
    [0.5, 2],
    [0, 1.5],
    [3, 2],
    [5, undefined],
    [0, 5]
  ])('readRange rejects invalid bounds from %s to %s', async (from, to) => {
    await save(descriptor, bytes);

    await expect(adapter.readRange(descriptor, from, to)).rejects.toThrow(RangeError);
  });

  test('readRange returns null for a missing file', async () => {
    expect(await adapter.readRange(descriptor, 0, 1)).toBeNull();
  });

  test('readRange rejects an empty file because it has no valid byte offset', async () => {
    await save(descriptor, Buffer.alloc(0));

    await expect(adapter.readRange(descriptor)).rejects.toThrow(RangeError);
  });

  test('readRange propagates filesystem errors other than a missing file', async () => {
    const file = join(directory, 'file.bin');
    const storage = new LocalStorageAdapter({ basePath: file });
    await writeFile(file, bytes);

    await expect(storage.readRange(descriptor, 0, 0)).rejects.toMatchObject({ code: 'ENOTDIR' });
  });

  test('delete removes an empty file, preserves its parent and succeeds if repeated', async () => {
    await save(descriptor, Buffer.alloc(0));

    await expect(adapter.delete(descriptor)).resolves.toBeUndefined();
    await expect(stat(join(directory, descriptor))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(directory)).isDirectory()).toBe(true);
    await expect(adapter.delete(descriptor)).resolves.toBeUndefined();
  });
});
