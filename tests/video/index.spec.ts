import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { addVideo, modifyTitle, modifyMeta, deleteVideo, getVideo, getVideos, addFile, readFile, deleteTsFiles, deleteAllFiles } from '@/video';
import mockFS from 'mock-fs';
import { LocalStorageAdapter } from '@/storage/adapters/LocalStorageAdapter';
import { exists } from '#/util';

const mocked_db = new InMemoryDatabaseAdapter();
const mocked_storage = new LocalStorageAdapter({ basePath: './base' });

jest.mock('@/db', () => {
  // noinspection JSUnusedGlobalSymbols used as mock
  return {
    async loadDb() {
      return mocked_db;
    }
  };
});

jest.mock('@/storage', () => {
  // noinspection JSUnusedGlobalSymbols used as mock
  return {
    async loadStorage() {
      return mocked_storage;
    }
  };
});

describe('video', () => {
  const testVideo = {
    videoId: 'testVideoId',
    title: 'videoTitle',
    meta: { a: 'x', b: 'y', c: 'z' },
    filesPrefix: 'sub',
    lastModified: new Date(0)
  };

  const expectedDate = new Date(42);

  beforeEach(() => {
    mocked_db.getMemory().video = { name: 'video', key: '', fields: {}, items: [] };
    jest.useFakeTimers();
    jest.setSystemTime(42);
  });

  afterEach(() => {
    delete mocked_db.getMemory().video;
    jest.useRealTimers();
    mockFS.restore();
  });

  test('addVideo adds video correctly.', async () => {
    await addVideo(testVideo);

    const videos = mocked_db.getMemory().video.items;
    expect(videos.length).toBe(1);
    expect(videos.at(0)).toEqual({ ...testVideo, lastModified: expectedDate });
  });

  test('modifyTitle modifies title correctly.', async () => {
    mocked_db.getMemory().video.items.push({ ...testVideo });

    const updated = await modifyTitle(testVideo.videoId, 'new title');

    const videos = mocked_db.getMemory().video.items;
    expect(videos.length).toBe(1);
    expect(videos.at(0)).toEqual({ ...testVideo, lastModified: expectedDate, title: 'new title' });
    expect(updated).toBe(true);
  });

  test('modifyMeta modifies meta correctly.', async () => {
    mocked_db.getMemory().video.items.push({ ...testVideo });

    const updated = await modifyMeta(testVideo.videoId, { a: 'a', b: 'b', c: 'c' });

    const videos = mocked_db.getMemory().video.items;
    expect(videos.length).toBe(1);
    expect(videos.at(0)).toEqual({ ...testVideo, lastModified: expectedDate, meta: { a: 'a', b: 'b', c: 'c' } });
    expect(updated).toBe(true);
  });

  test('deleteVideo deletes correctly.', async () => {
    mocked_db.getMemory().video.items.push({ ...testVideo });
    mocked_db.getMemory().video.items.push({ ...testVideo, videoId: 'other' });

    const deleted = await deleteVideo(testVideo.videoId);

    const videos = mocked_db.getMemory().video.items;
    expect(videos.length).toBe(1);
    expect(videos.at(0)).toEqual({ ...testVideo, videoId: 'other' });
    expect(deleted).toBe(true);
  });

  test('getVideo gets video correctly.', async () => {
    mocked_db.getMemory().video.items.push({ ...testVideo });

    const video = await getVideo(testVideo.videoId);

    expect(video).toEqual({ ...testVideo });
  });

  test('getVideos gets all videos correctly.', async () => {
    const video1 = { ...testVideo, videoId: 'id1' };
    const video2 = { ...testVideo, videoId: 'id2' };
    const video3 = { ...testVideo, videoId: 'id3' };
    mocked_db.getMemory().video.items.push(video1);
    mocked_db.getMemory().video.items.push(video2);
    mocked_db.getMemory().video.items.push(video3);

    const videos = await getVideos(new Date(0));

    expect(videos).toEqual([video1, video2, video3]);
  });

  test('getVideos gets all videos since correctly.', async () => {
    const video1 = { ...testVideo, videoId: 'id1', lastModified: new Date(5) };
    const video2 = { ...testVideo, videoId: 'id2', lastModified: new Date(42) };
    const video3 = { ...testVideo, videoId: 'id3', lastModified: new Date(42) };
    mocked_db.getMemory().video.items.push(video1);
    mocked_db.getMemory().video.items.push(video2);
    mocked_db.getMemory().video.items.push(video3);

    const videos = await getVideos(new Date(40));

    expect(videos).toEqual([video2, video3]);
  });

  test('addFile adds file correctly, not ts.', async () => {
    mocked_db.getMemory().video.items.push({ ...testVideo });
    jest.useRealTimers();
    mockFS({ './base/sub/test': '' });

    const error = await addFile(testVideo.videoId, 'test', Buffer.from('content', 'utf8'));

    expect(((await mocked_storage.read('sub/test')) ?? Buffer.from('')).toString('utf8')).toEqual('content');
    expect(error).toBeNull();
    expect(mocked_db.getMemory().video.items.at(0)?.lastModified?.getTime()).toBeGreaterThanOrEqual(new Date().getTime() - 500);
    expect(mocked_db.getMemory().video.items.at(0)?.lastModified?.getTime()).toBeLessThanOrEqual(new Date().getTime());
  });

  test('addFile adds file correctly, ts.', async () => {
    mocked_db.getMemory().video.items.push({ ...testVideo });
    jest.useRealTimers();
    mockFS({ './base/sub/ts/test.ts.enc': '' });

    const error = await addFile(testVideo.videoId, 'test.ts.enc', Buffer.from('content', 'utf8'));

    expect(((await mocked_storage.read('sub/ts/test.ts.enc')) ?? Buffer.from('')).toString('utf8')).toEqual('content');
    expect(error).toBeNull();
    expect(mocked_db.getMemory().video.items.at(0)?.lastModified?.getTime()).toBeGreaterThanOrEqual(new Date().getTime() - 500);
    expect(mocked_db.getMemory().video.items.at(0)?.lastModified?.getTime()).toBeLessThanOrEqual(new Date().getTime());
  });

  test('addFile returns error if video does not exist.', async () => {
    mocked_db.getMemory().video.items.push({ ...testVideo });
    jest.useRealTimers();
    mockFS({ './base/sub/test': '' });

    const error = await addFile('other', 'test', Buffer.from('content', 'utf8'));

    expect(((await mocked_storage.read('sub/test')) ?? Buffer.from('')).toString('utf8')).toEqual('');
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toEqual('no-such-video');
    expect(mocked_db.getMemory().video.items.at(0)?.lastModified?.getTime()).toBe(0);
  });

  test('deleteTsFiles deletes ts files correctly.', async () => {
    mocked_db.getMemory().video.items.push({ ...testVideo });
    jest.useRealTimers();
    mockFS({ './base/sub': { test1: '', test2: '', test3: '', ts: { file1: '', file2: '', file3: '' } } });

    const [error, deleted] = await deleteTsFiles(testVideo.videoId);

    expect(await mocked_storage.read('sub/test1')).toBeInstanceOf(Buffer);
    expect(await mocked_storage.read('sub/test2')).toBeInstanceOf(Buffer);
    expect(await mocked_storage.read('sub/test3')).toBeInstanceOf(Buffer);
    expect(await exists('./base/sub/ts')).toBe(false);
    expect(error).toBeNull();
    expect(deleted).toBe(true);
  });

  test('deleteTsFiles returns error if no such video.', async () => {
    mocked_db.getMemory().video.items.push({ ...testVideo });
    jest.useRealTimers();
    mockFS({ './base/sub': { test1: '', test2: '', test3: '', ts: { file1: '', file2: '', file3: '' } } });

    const [error] = await deleteTsFiles('other');

    expect(await mocked_storage.read('sub/test1')).toBeInstanceOf(Buffer);
    expect(await mocked_storage.read('sub/test2')).toBeInstanceOf(Buffer);
    expect(await mocked_storage.read('sub/test3')).toBeInstanceOf(Buffer);
    expect(await mocked_storage.read('sub/ts/file1')).toBeInstanceOf(Buffer);
    expect(await mocked_storage.read('sub/ts/file2')).toBeInstanceOf(Buffer);
    expect(await mocked_storage.read('sub/ts/file3')).toBeInstanceOf(Buffer);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toEqual('no-such-video');
  });

  test('deleteAllFiles deletes files correctly.', async () => {
    mocked_db.getMemory().video.items.push({ ...testVideo });
    jest.useRealTimers();
    mockFS({ './base/sub': { test1: '', test2: '', test3: '' } });

    const [error, deleted] = await deleteAllFiles(testVideo.videoId);

    expect(await mocked_storage.read('sub/test1')).toBeNull();
    expect(await mocked_storage.read('sub/test2')).toBeNull();
    expect(await mocked_storage.read('sub/test3')).toBeNull();
    expect(error).toBeNull();
    expect(deleted).toBe(true);
  });

  test('deleteAllFiles returns error if no such video.', async () => {
    mocked_db.getMemory().video.items.push({ ...testVideo });
    jest.useRealTimers();
    mockFS({ './base/sub': { test1: 'content', test2: 'content', test3: 'content' } });

    const [error] = await deleteAllFiles('other');

    expect(((await mocked_storage.read('sub/test1')) ?? Buffer.from('')).toString('utf8')).toEqual('content');
    expect(((await mocked_storage.read('sub/test2')) ?? Buffer.from('')).toString('utf8')).toEqual('content');
    expect(((await mocked_storage.read('sub/test3')) ?? Buffer.from('')).toString('utf8')).toEqual('content');
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toEqual('no-such-video');
  });

  test('readFile reads file correctly, not ts.', async () => {
    mocked_db.getMemory().video.items.push({ ...testVideo });
    jest.useRealTimers();
    mockFS({ './base/sub/test': 'content' });

    const result = await readFile('sub', 'test');

    expect(result).toBeInstanceOf(Buffer);
    expect(result?.toString('utf8')).toEqual('content');
    expect(mocked_db.getMemory().video.items.at(0)?.lastModified?.getTime()).toBe(0);
  });

  test('readFile reads file correctly, ts.', async () => {
    mocked_db.getMemory().video.items.push({ ...testVideo });
    jest.useRealTimers();
    mockFS({ './base/sub/ts/test.ts.enc': 'content' });

    const result = await readFile('sub', 'test.ts.enc');

    expect(result).toBeInstanceOf(Buffer);
    expect(result?.toString('utf8')).toEqual('content');
    expect(mocked_db.getMemory().video.items.at(0)?.lastModified?.getTime()).toBe(0);
  });
});
