import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';

describe('InMemoryStorageAdapter', () => {
  const descriptor = 'clip.bin';
  const bytes = Buffer.from([0, 127, 128, 255, 42]);
  let adapter: InMemoryStorageAdapter;

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
  });

  test('save stores binary data and replaces it when the same name is saved again', async () => {
    await adapter.save(descriptor, bytes);
    expect(await adapter.read(descriptor)).toEqual(bytes);

    const replacement = Buffer.from([255]);
    await adapter.save(descriptor, replacement);
    expect(await adapter.read(descriptor)).toEqual(replacement);
  });

  test('read distinguishes a missing entry from an empty buffer', async () => {
    await adapter.save('empty.bin', Buffer.alloc(0));

    expect(await adapter.read(descriptor)).toBeNull();
    expect(await adapter.read('empty.bin')).toEqual(Buffer.alloc(0));
  });

  test('adapter instances have separate storage', async () => {
    await adapter.save(descriptor, bytes);

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

  test('readRange returns null for a missing entry', async () => {
    expect(await adapter.readRange(descriptor, 0, 1)).toBeNull();
  });

  test('readRange rejects an empty buffer because it has no valid byte offset', async () => {
    await adapter.save(descriptor, Buffer.alloc(0));

    await expect(adapter.readRange(descriptor)).rejects.toThrow(RangeError);
  });

  test('delete removes only the selected entry and succeeds when repeated', async () => {
    await adapter.save(descriptor, Buffer.alloc(0));
    await adapter.save('other.bin', bytes);

    await expect(adapter.delete(descriptor)).resolves.toBeUndefined();
    expect(await adapter.read(descriptor)).toBeNull();
    expect(await adapter.read('other.bin')).toEqual(bytes);
    await expect(adapter.delete(descriptor)).resolves.toBeUndefined();
  });
});
