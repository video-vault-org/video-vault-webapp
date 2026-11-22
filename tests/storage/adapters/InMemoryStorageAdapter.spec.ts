import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';

describe('InMemoryStorageAdapter', () => {
  const descriptor = 'clip.bin';
  const bytes = Buffer.from([0, 127, 128, 255, 42]);
  let directory: string;
  let adapter: InMemoryStorageAdapter;

  const save = async function (descriptor: string, data: Buffer): Promise<void> {
    const source = join(directory, 'upload.tmp');
    await writeFile(source, data);
    await adapter.save(source, descriptor);
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'video-vault-memory-storage-'));
    adapter = new InMemoryStorageAdapter();
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

  test('save stores binary data and replaces it when the same name is saved again', async () => {
    await save(descriptor, bytes);
    expect(await adapter.read(descriptor)).toEqual(bytes);

    const replacement = Buffer.from([255]);
    await save(descriptor, replacement);
    expect(await adapter.read(descriptor)).toEqual(replacement);
  });

  test('save rejects a missing source without changing an existing entry', async () => {
    await save(descriptor, bytes);

    await expect(adapter.save(join(directory, 'missing.tmp'), descriptor)).rejects.toMatchObject({ code: 'ENOENT' });

    expect(await adapter.read(descriptor)).toEqual(bytes);
  });

  test('read distinguishes a missing entry from an empty buffer', async () => {
    await save('empty.bin', Buffer.alloc(0));

    expect(await adapter.read(descriptor)).toBeNull();
    expect(await adapter.read('empty.bin')).toEqual(Buffer.alloc(0));
  });

  test('adapter instances have separate storage', async () => {
    await save(descriptor, bytes);

    expect(await new InMemoryStorageAdapter().read(descriptor)).toBeNull();
  });

  test.each([
    [1, 3, Buffer.from([127, 128, 255])],
    [2, 2, Buffer.from([128])],
    [2, undefined, Buffer.from([128, 255, 42])],
    [undefined, 0, Buffer.from([0])],
    [undefined, undefined, bytes],
    [4, 4, Buffer.from([42])]
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

  test('readRange returns null for a missing entry', async () => {
    expect(await adapter.readRange(descriptor, 0, 1)).toBeNull();
  });

  test('readRange rejects an empty buffer because it has no valid byte offset', async () => {
    await save(descriptor, Buffer.alloc(0));

    await expect(adapter.readRange(descriptor)).rejects.toThrow(RangeError);
  });

  test('delete removes only the selected entry and succeeds when repeated', async () => {
    await save(descriptor, Buffer.alloc(0));
    await save('other.bin', bytes);

    await expect(adapter.delete(descriptor)).resolves.toBeUndefined();
    expect(await adapter.read(descriptor)).toBeNull();
    expect(await adapter.read('other.bin')).toEqual(bytes);
    await expect(adapter.delete(descriptor)).resolves.toBeUndefined();
  });
});
