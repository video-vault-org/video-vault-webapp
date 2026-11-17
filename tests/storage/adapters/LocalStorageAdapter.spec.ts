import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageAdapter } from '@/storage/adapters/LocalStorageAdapter';

describe('LocalStorageAdapter', () => {
  const descriptor = 'clip.bin';
  const bytes = Buffer.from([0, 127, 128, 255, 42]);
  let directory: string;
  let adapter: LocalStorageAdapter;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'video-vault-storage-'));
    adapter = new LocalStorageAdapter({ basePath: directory });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test('getBasePath returns the configured path', () => {
    expect(adapter.getBasePath()).toBe(directory);
  });

  test('save writes to the base directory and overwrites an existing file', async () => {
    const path = join(directory, descriptor);
    await adapter.save(descriptor, bytes);
    expect(await readFile(path)).toEqual(bytes);

    await adapter.save(descriptor, Buffer.from([255]));
    expect(await readFile(path)).toEqual(Buffer.from([255]));
  });

  test('read returns the exact file bytes', async () => {
    await writeFile(join(directory, 'existing.bin'), bytes);

    expect(await adapter.read('existing.bin')).toEqual(bytes);
  });

  test('read returns null for a missing file and a buffer for an empty file', async () => {
    await adapter.save('empty.bin', Buffer.alloc(0));

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
    await adapter.save(descriptor, bytes);

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
    await adapter.save(descriptor, bytes);

    await expect(adapter.readRange(descriptor, from, to)).rejects.toThrow(RangeError);
  });

  test('readRange returns null for a missing file', async () => {
    expect(await adapter.readRange(descriptor, 0, 1)).toBeNull();
  });

  test('readRange rejects an empty file because it has no valid byte offset', async () => {
    await adapter.save(descriptor, Buffer.alloc(0));

    await expect(adapter.readRange(descriptor)).rejects.toThrow(RangeError);
  });

  test('readRange propagates filesystem errors other than a missing file', async () => {
    const file = join(directory, 'file.bin');
    const storage = new LocalStorageAdapter({ basePath: file });
    await writeFile(file, bytes);

    await expect(storage.readRange(descriptor, 0, 0)).rejects.toMatchObject({ code: 'ENOTDIR' });
  });

  test('delete removes an empty file, preserves its parent and succeeds if repeated', async () => {
    await adapter.save(descriptor, Buffer.alloc(0));

    await expect(adapter.delete(descriptor)).resolves.toBeUndefined();
    await expect(stat(join(directory, descriptor))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(directory)).isDirectory()).toBe(true);
    await expect(adapter.delete(descriptor)).resolves.toBeUndefined();
  });
});
