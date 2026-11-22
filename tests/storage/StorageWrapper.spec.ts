import { access, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import fs from 'fs/promises';
import { StorageWrapper } from '@/storage/StorageWrapper';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';

describe('StorageWrapper', () => {
  const videoId = 'clip';
  const video = Buffer.from([0, 127, 128, 255]);
  const thumbnail = Buffer.from([42]);
  let directory: string;
  let temporaryDirectory: string;
  let adapter: InMemoryStorageAdapter;
  let storage: StorageWrapper;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'video-vault-storage-wrapper-'));
    temporaryDirectory = join(directory, 'tmp');
    await mkdir(temporaryDirectory);
    await writeFile(join(temporaryDirectory, 'clip.video'), video);
    await writeFile(join(temporaryDirectory, 'clip.thumbnail'), thumbnail);
    adapter = new InMemoryStorageAdapter();
    storage = new StorageWrapper(adapter, { temporaryDirectory });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  async function save(descriptor: string, data: Buffer): Promise<void> {
    const source = join(temporaryDirectory, descriptor);
    await writeFile(source, data);
    await adapter.save(source, descriptor);
  }

  test('videoFileSize returns only the encrypted video length or null', async () => {
    expect(await storage.videoFileSize({ videoId })).toBeNull();
    await storage.saveVideoFile({ videoId });
    await storage.saveThumbnailFile({ videoId });
    expect(await storage.videoFileSize({ videoId })).toBe(video.length);
    const error = new Error('denied');
    jest.spyOn(adapter, 'size').mockRejectedValueOnce(error);
    await expect(storage.videoFileSize({ videoId })).rejects.toBe(error);
  });

  test('deleteTemporaryFiles removes both temporary files and preserves stored and unrelated files', async () => {
    await storage.saveVideoFile({ videoId });
    await storage.saveThumbnailFile({ videoId });
    await writeFile(join(temporaryDirectory, 'other.video'), 'unrelated');
    await storage.deleteTemporaryFiles({ videoId });
    await expect(access(join(temporaryDirectory, 'clip.video'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(temporaryDirectory, 'clip.thumbnail'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(temporaryDirectory, 'other.video'), 'utf8')).toBe('unrelated');
    expect(await adapter.read('clip.video')).toEqual(video);
    expect(await adapter.read('clip.thumbnail')).toEqual(thumbnail);
    await expect(storage.deleteTemporaryFiles({ videoId })).resolves.toBeUndefined();
  });

  test.each(['video', 'thumbnail'] as const)('deleteTemporaryFiles can remove only the selected %s file', async (file) => {
    await storage.deleteTemporaryFiles({ videoId, files: [file] });
    await expect(access(join(temporaryDirectory, `clip.${file}`))).rejects.toMatchObject({ code: 'ENOENT' });
    const other = file === 'video' ? 'thumbnail' : 'video';
    expect(await readFile(join(temporaryDirectory, `clip.${other}`))).toEqual(other === 'video' ? video : thumbnail);
  });

  test('deleteTemporaryFiles propagates deletion errors and attempts both files', async () => {
    const error = new Error('Permission denied');
    const remove = jest.spyOn(fs, 'rm').mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
    await expect(storage.deleteTemporaryFiles({ videoId })).rejects.toBe(error);
    expect(remove).toHaveBeenCalledWith(join(temporaryDirectory, 'clip.video'), { force: true });
    expect(remove).toHaveBeenCalledWith(join(temporaryDirectory, 'clip.thumbnail'), { force: true });
  });

  test('deleteTemporaryFiles respects the configured temporary directory', async () => {
    const customDirectory = join(directory, 'custom-tmp');
    await mkdir(customDirectory);
    await writeFile(join(customDirectory, 'clip.video'), video);
    await writeFile(join(customDirectory, 'clip.thumbnail'), thumbnail);
    const custom = new StorageWrapper(adapter, { temporaryDirectory: customDirectory });
    await custom.deleteTemporaryFiles({ videoId });
    await expect(access(join(customDirectory, 'clip.video'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(customDirectory, 'clip.thumbnail'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(temporaryDirectory, 'clip.video'))).toEqual(video);
  });

  test('saveVideoFile stores the video under its video descriptor', async () => {
    const saveSpy = jest.spyOn(adapter, 'save');
    await storage.saveVideoFile({ videoId });

    expect(saveSpy).toHaveBeenCalledWith(join(temporaryDirectory, 'clip.video'), 'clip.video');

    expect(await adapter.read('clip.video')).toEqual(video);
  });

  test('saveThumbnailFile stores the thumbnail separately from the video', async () => {
    await save('clip.video', video);
    const saveSpy = jest.spyOn(adapter, 'save');
    await storage.saveThumbnailFile({ videoId });

    expect(saveSpy).toHaveBeenCalledWith(join(temporaryDirectory, 'clip.thumbnail'), 'clip.thumbnail');

    expect(await adapter.read('clip.thumbnail')).toEqual(thumbnail);
    expect(await adapter.read('clip.video')).toEqual(video);
  });

  test.each(['saveVideoFile', 'saveThumbnailFile'] as const)('%s propagates adapter errors', async (method) => {
    const error = new Error('Storage unavailable');
    jest.spyOn(adapter, 'save').mockRejectedValueOnce(error);

    await expect(storage[method]({ videoId })).rejects.toBe(error);
  });

  test.each([
    ['saveVideoFile', 'clip.video'],
    ['saveThumbnailFile', 'clip.thumbnail']
  ] as const)('%s rejects a missing temporary file without calling the adapter', async (method, filename) => {
    await unlink(join(temporaryDirectory, filename));
    const saveSpy = jest.spyOn(adapter, 'save');

    await expect(storage[method]({ videoId })).rejects.toThrow('tmp file does not exist');

    expect(saveSpy).not.toHaveBeenCalled();
    expect(await adapter.read(filename)).toBeNull();
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
