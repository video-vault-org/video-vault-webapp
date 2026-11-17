import { StorageWrapper } from '@/storage/StorageWrapper';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';

describe('StorageWrapper', () => {
  const videoId = 'clip';
  const video = Buffer.from([0, 127, 128, 255]);
  const thumbnail = Buffer.from([42]);
  let adapter: InMemoryStorageAdapter;
  let storage: StorageWrapper;

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
    storage = new StorageWrapper(adapter);
  });

  test('saveVideoFile stores the video under its video descriptor', async () => {
    await storage.saveVideoFile({ videoId, data: video });

    expect(await adapter.read('clip.video')).toEqual(video);
  });

  test('saveThumbnailFile stores the thumbnail separately from the video', async () => {
    await adapter.save('clip.video', video);
    await storage.saveThumbnailFile({ videoId, data: thumbnail });

    expect(await adapter.read('clip.thumbnail')).toEqual(thumbnail);
    expect(await adapter.read('clip.video')).toEqual(video);
  });

  test('readVideoFileRange reads inclusive bounds and allows either bound to be omitted', async () => {
    await adapter.save('clip.video', video);

    expect(await storage.readVideoFileRange({ videoId, from: 1, to: 2 })).toEqual(Buffer.from([127, 128]));
    expect(await storage.readVideoFileRange({ videoId, to: 0 })).toEqual(Buffer.from([0]));
    expect(await storage.readVideoFileRange({ videoId, from: 2 })).toEqual(Buffer.from([128, 255]));
    expect(await storage.readVideoFileRange({ videoId })).toEqual(video);
    await expect(storage.readVideoFileRange({ videoId, from: 2, to: 1 })).rejects.toThrow(RangeError);
  });

  test('readVideoFileRange returns null if only a thumbnail exists', async () => {
    await adapter.save('clip.thumbnail', thumbnail);

    expect(await storage.readVideoFileRange({ videoId, from: 0, to: 0 })).toBeNull();
  });

  test('readThumbnailFile reads the full thumbnail and returns null if it is missing', async () => {
    await adapter.save('clip.video', video);
    expect(await storage.readThumbnailFile({ videoId })).toBeNull();

    await adapter.save('clip.thumbnail', thumbnail);
    expect(await storage.readThumbnailFile({ videoId })).toEqual(thumbnail);
  });

  test('deleteFiles removes both files for the requested video and leaves other files intact', async () => {
    await adapter.save('clip.video', video);
    await adapter.save('clip.thumbnail', thumbnail);
    await adapter.save('other.video', video);
    await adapter.save('other.thumbnail', thumbnail);

    await storage.deleteFiles({ videoId });

    expect(await adapter.read('clip.video')).toBeNull();
    expect(await adapter.read('clip.thumbnail')).toBeNull();
    expect(await adapter.read('other.video')).toEqual(video);
    expect(await adapter.read('other.thumbnail')).toEqual(thumbnail);
  });

  test('deleteFiles still removes a thumbnail when its video file is missing', async () => {
    await adapter.save('clip.thumbnail', thumbnail);

    await storage.deleteFiles({ videoId });

    expect(await adapter.read('clip.thumbnail')).toBeNull();
  });

  test('deleteFiles still removes a video when its thumbnail file is missing', async () => {
    await adapter.save('clip.video', video);

    await storage.deleteFiles({ videoId });

    expect(await adapter.read('clip.video')).toBeNull();
  });
});
