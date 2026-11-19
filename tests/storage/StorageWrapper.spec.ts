import { writeFile } from 'node:fs/promises';
import mockFS from 'mock-fs';
import { StorageWrapper } from '@/storage/StorageWrapper';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';

describe('StorageWrapper', () => {
  const videoId = 'clip';
  const video = Buffer.from([0, 127, 128, 255]);
  const thumbnail = Buffer.from([42]);
  let adapter: InMemoryStorageAdapter;
  let storage: StorageWrapper;

  beforeEach(() => {
    mockFS({ './tmp': { 'clip.video': video, 'clip.thumbnail': thumbnail } });
    adapter = new InMemoryStorageAdapter();
    storage = new StorageWrapper(adapter);
  });

  afterEach(() => {
    mockFS.restore();
  });

  async function save(descriptor: string, data: Buffer): Promise<void> {
    const source = `./tmp/${descriptor}`;
    await writeFile(source, data);
    await adapter.save(source, descriptor);
  }

  test('saveVideoFile stores the video under its video descriptor', async () => {
    const saveSpy = jest.spyOn(adapter, 'save');
    await storage.saveVideoFile({ videoId });

    expect(saveSpy).toHaveBeenCalledWith('./tmp/clip.video', 'clip.video');

    expect(await adapter.read('clip.video')).toEqual(video);
  });

  test('saveThumbnailFile stores the thumbnail separately from the video', async () => {
    await save('clip.video', video);
    const saveSpy = jest.spyOn(adapter, 'save');
    await storage.saveThumbnailFile({ videoId });

    expect(saveSpy).toHaveBeenCalledWith('./tmp/clip.thumbnail', 'clip.thumbnail');

    expect(await adapter.read('clip.thumbnail')).toEqual(thumbnail);
    expect(await adapter.read('clip.video')).toEqual(video);
  });

  test.each(['saveVideoFile', 'saveThumbnailFile'] as const)('%s propagates adapter errors', async (method) => {
    const error = new Error('Storage unavailable');
    jest.spyOn(adapter, 'save').mockRejectedValueOnce(error);

    await expect(storage[method]({ videoId })).rejects.toBe(error);
  });

  test('readVideoFileRange reads inclusive bounds and allows either bound to be omitted', async () => {
    await save('clip.video', video);

    expect(await storage.readVideoFileRange({ videoId, from: 1, to: 2 })).toEqual(Buffer.from([127, 128]));
    expect(await storage.readVideoFileRange({ videoId, to: 0 })).toEqual(Buffer.from([0]));
    expect(await storage.readVideoFileRange({ videoId, from: 2 })).toEqual(Buffer.from([128, 255]));
    expect(await storage.readVideoFileRange({ videoId })).toEqual(video);
    await expect(storage.readVideoFileRange({ videoId, from: 2, to: 1 })).rejects.toThrow(RangeError);
  });

  test('readVideoFileRange returns null if only a thumbnail exists', async () => {
    await save('clip.thumbnail', thumbnail);

    expect(await storage.readVideoFileRange({ videoId, from: 0, to: 0 })).toBeNull();
  });

  test('readThumbnailFile reads the full thumbnail and returns null if it is missing', async () => {
    await save('clip.video', video);
    expect(await storage.readThumbnailFile({ videoId })).toBeNull();

    await save('clip.thumbnail', thumbnail);
    expect(await storage.readThumbnailFile({ videoId })).toEqual(thumbnail);
  });

  test('deleteFiles removes both files for the requested video and leaves other files intact', async () => {
    await save('clip.video', video);
    await save('clip.thumbnail', thumbnail);
    await save('other.video', video);
    await save('other.thumbnail', thumbnail);

    await storage.deleteFiles({ videoId });

    expect(await adapter.read('clip.video')).toBeNull();
    expect(await adapter.read('clip.thumbnail')).toBeNull();
    expect(await adapter.read('other.video')).toEqual(video);
    expect(await adapter.read('other.thumbnail')).toEqual(thumbnail);
  });

  test('deleteFiles still removes a thumbnail when its video file is missing', async () => {
    await save('clip.thumbnail', thumbnail);

    await storage.deleteFiles({ videoId });

    expect(await adapter.read('clip.thumbnail')).toBeNull();
  });

  test('deleteFiles still removes a video when its thumbnail file is missing', async () => {
    await save('clip.video', video);

    await storage.deleteFiles({ videoId });

    expect(await adapter.read('clip.video')).toBeNull();
  });
});
