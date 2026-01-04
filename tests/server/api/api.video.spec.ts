import request from 'supertest';
import express from 'express';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { LocalStorageAdapter } from '@/storage/adapters/LocalStorageAdapter';
import { buildVideoApi } from '@/server/api/videoApi';
import { createEmptyFile, deleteDirectory, exists } from '#/util';
import { AuthorizedUserRequest } from '@/server/types/AuthorizedUserRequest';
import { User } from '@/user/types/User';
import { mkdir, writeFile } from 'fs/promises';

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

describe('api - video', () => {
  const testVideo = {
    videoId: 'testVideoId',
    title: 'videoTitle',
    meta: { a: 'x', b: 'y', c: 'z' },
    filesPrefix: 'sub',
    lastModified: new Date(0)
  };

  const testUser: User = {
    userId: 'testUserId',
    username: 'testName',
    displayName: 'testDisplayName',
    passwordKeySalt: 'testSalt',
    userKey: 'testKey',
    hash: 'testHash',
    hashSalt: 'testSalt',
    hashAlgorithm: 'testAlgo',
    userManager: true,
    videoManager: false,
    admin: true
  };

  const buildApi = function (videoManager: boolean) {
    const videoApi = buildVideoApi();
    const api = express();
    api.use(async (req, _, next) => {
      (req as AuthorizedUserRequest).authorizedUser = { ...testUser, videoManager };
      next();
    });
    api.use(express.json());
    api.use('/video', videoApi);
    return api;
  };

  const expectedDate = new Date(42);

  beforeEach(async () => {
    mocked_db.getMemory().comment = { name: 'comment', key: '', fields: {}, items: [] };
    mocked_db.getMemory().video = { name: 'video', key: '', fields: {}, items: [] };
    mocked_db.getMemory().user_ = { name: 'user_', key: '', fields: {}, items: [] };
    jest.useFakeTimers();
    jest.setSystemTime(expectedDate);
  });

  afterEach(async () => {
    delete mocked_db.getMemory().comment;
    delete mocked_db.getMemory().video;
    delete mocked_db.getMemory().user;
    jest.useRealTimers();
    await deleteDirectory('./base');
  });

  describe('videoManagerHandler', () => {
    test('calls next if user is video manager.', async () => {
      const api = buildApi(true);
      api.post('/video/manage/test', (_, res) => {
        res.status(200).json({ message: 'ok' });
      });

      const response = await request(api).post('/video/manage/test');

      expect(response.status).toBe(200);
      expect(response.body?.message).toEqual('ok');
    });

    test('responses error if user is not video manager.', async () => {
      const api = buildApi(false);
      api.post('/video/manage/test', (_, res) => {
        res.status(200).json({ message: 'ok' });
      });

      const response = await request(api).post('/video/manage/test');

      expect(response.status).toBe(403);
      expect(response.body?.error).toEqual('forbidden');
    });
  });

  describe('addVideoHandler', () => {
    test('adds video correctly.', async () => {
      const api = buildApi(true);

      const response = await request(api).post('/video/manage/add').send({ video: testVideo });

      expect(response.status).toBe(201);
      expect(response.body.message).toEqual('created');
      expect(mocked_db.getMemory().video.items.at(0)).toEqual({ ...testVideo, lastModified: expectedDate });
    });

    test('responses error if video already exists.', async () => {
      const api = buildApi(true);
      mocked_db.getMemory().video.items.push({ ...testVideo });

      const response = await request(api).post('/video/manage/add').send({ video: testVideo });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('video-exists');
      expect(mocked_db.getMemory().video.items.at(0)).toEqual({ ...testVideo });
    });
  });

  describe('modifyTitleHandler', () => {
    test('modifies title correctly.', async () => {
      const api = buildApi(true);
      mocked_db.getMemory().video.items.push({ ...testVideo });

      const response = await request(api).post('/video/manage/modify-title').send({ videoId: testVideo.videoId, title: 'new-title' });

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('updated');
      expect(mocked_db.getMemory().video.items.at(0)).toEqual({ ...testVideo, lastModified: expectedDate, title: 'new-title' });
    });

    test('responses error if video does not exist.', async () => {
      const api = buildApi(true);

      const response = await request(api).post('/video/manage/modify-title').send({ videoId: testVideo.videoId, title: '' });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('no-such-video');
      expect(mocked_db.getMemory().video.items.length).toBe(0);
    });
  });

  describe('modifyMetaHandler', () => {
    test('modifies meta correctly.', async () => {
      const api = buildApi(true);
      mocked_db.getMemory().video.items.push({ ...testVideo });

      const response = await request(api)
        .post('/video/manage/modify-meta')
        .send({ videoId: testVideo.videoId, meta: { abc: 'xyz' } });

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('updated');
      expect(mocked_db.getMemory().video.items.at(0)).toEqual({ ...testVideo, lastModified: expectedDate, meta: { abc: 'xyz' } });
    });

    test('responses error if video does not exist.', async () => {
      const api = buildApi(true);

      const response = await request(api).post('/video/manage/modify-meta').send({ videoId: testVideo.videoId, meta: {} });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('no-such-video');
      expect(mocked_db.getMemory().video.items.length).toBe(0);
    });
  });

  describe('deleteVideoHandler', () => {
    test('deletes video, related comments and all related files correctly.', async () => {
      const api = buildApi(true);
      mocked_db.getMemory().video.items.push({ ...testVideo, filesPrefix: 'sub1' });
      mocked_db.getMemory().video.items.push({ ...testVideo, filesPrefix: 'sub2', videoId: 'other' });
      mocked_db.getMemory().comment.items.push({ commentId: 'id1', videoId: testVideo.videoId });
      mocked_db.getMemory().comment.items.push({ commentId: 'id2', videoId: testVideo.videoId });
      mocked_db.getMemory().comment.items.push({ commentId: 'id3', videoId: 'other' });
      await createEmptyFile('./base/sub1/file1');
      await createEmptyFile('./base/sub1/file2');
      await createEmptyFile('./base/sub1/file3');
      await createEmptyFile('./base/sub2/file');

      const response = await request(api).delete('/video/manage/delete/' + testVideo.videoId);

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('removed');
      expect(mocked_db.getMemory().video.items.length).toBe(1);
      expect(mocked_db.getMemory().comment.items.length).toBe(1);
      expect(mocked_db.getMemory().video.items.at(0)).toEqual({ ...testVideo, filesPrefix: 'sub2', videoId: 'other' });
      expect(mocked_db.getMemory().comment.items.at(0)).toEqual({ commentId: 'id3', videoId: 'other' });
      expect(await exists('./base/sub1')).toBe(false);
      expect(await exists('./base/sub2/file')).toBe(true);
    });

    test('responses error if video does not exist.', async () => {
      const api = buildApi(true);
      mocked_db.getMemory().video.items.push({ ...testVideo, filesPrefix: 'sub1' });
      mocked_db.getMemory().video.items.push({ ...testVideo, filesPrefix: 'sub2', videoId: 'other' });
      mocked_db.getMemory().comment.items.push({ commentId: 'id1', videoId: testVideo.videoId });
      mocked_db.getMemory().comment.items.push({ commentId: 'id2', videoId: testVideo.videoId });
      mocked_db.getMemory().comment.items.push({ commentId: 'id3', videoId: 'other' });
      await createEmptyFile('./base/sub1/file1');
      await createEmptyFile('./base/sub1/file2');
      await createEmptyFile('./base/sub1/file3');
      await createEmptyFile('./base/sub2/file');

      const response = await request(api).delete('/video/manage/delete/other2');

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('no-such-video');
      expect(mocked_db.getMemory().video.items.length).toBe(2);
      expect(mocked_db.getMemory().comment.items.length).toBe(3);
      expect(await exists('./base/sub1/file1')).toBe(true);
      expect(await exists('./base/sub2/file')).toBe(true);
    });
  });

  describe('getVideoHandler', () => {
    test('gets Video correctly.', async () => {
      const api = buildApi(false);
      mocked_db.getMemory().video.items.push({ ...testVideo });
      mocked_db.getMemory().video.items.push({ ...testVideo, videoId: 'other' });

      const response = await request(api).get('/video/single-video/' + testVideo.videoId);

      expect(response.status).toBe(200);
      expect(response.body.video).toEqual({ ...testVideo, lastModified: testVideo.lastModified.toISOString() });
    });

    test('responses error if video does not exist.', async () => {
      const api = buildApi(false);
      mocked_db.getMemory().video.items.push({ ...testVideo });
      mocked_db.getMemory().video.items.push({ ...testVideo, videoId: 'other' });

      const response = await request(api).get('/video/single-video/other2');

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('no-such-video');
    });
  });

  describe('getVideosHandler', () => {
    test('gets Videos correctly, all', async () => {
      const api = buildApi(false);
      mocked_db.getMemory().video.items.push({ ...testVideo, videoId: 'id1' });
      mocked_db.getMemory().video.items.push({ ...testVideo, videoId: 'id2' });
      mocked_db.getMemory().video.items.push({ ...testVideo, videoId: 'id3' });

      const response = await request(api).get('/video/videos/-');

      expect(response.status).toBe(200);
      expect(response.body.videos.length).toBe(3);
      expect(response.body.videos.at(0)).toEqual({ ...testVideo, videoId: 'id1', lastModified: testVideo.lastModified.toISOString() });
      expect(response.body.videos.at(1)).toEqual({ ...testVideo, videoId: 'id2', lastModified: testVideo.lastModified.toISOString() });
      expect(response.body.videos.at(2)).toEqual({ ...testVideo, videoId: 'id3', lastModified: testVideo.lastModified.toISOString() });
    });

    test('gets Videos correctly, since', async () => {
      const api = buildApi(false);
      mocked_db.getMemory().video.items.push({ ...testVideo, videoId: 'id1', lastModified: new Date(5) });
      mocked_db.getMemory().video.items.push({ ...testVideo, videoId: 'id2', lastModified: new Date(42) });
      mocked_db.getMemory().video.items.push({ ...testVideo, videoId: 'id3', lastModified: new Date(42) });

      const response = await request(api).get('/video/videos/' + new Date(40).toISOString());

      expect(response.status).toBe(200);
      expect(response.body.videos.length).toBe(2);
      expect(response.body.videos.at(0)).toEqual({ ...testVideo, videoId: 'id2', lastModified: new Date(42).toISOString() });
      expect(response.body.videos.at(1)).toEqual({ ...testVideo, videoId: 'id3', lastModified: new Date(42).toISOString() });
    });
  });

  describe('uploadFileHandler', () => {
    test('uploads file correctly, no ts.', async () => {
      const api = buildApi(true);
      mocked_db.getMemory().video.items.push({ ...testVideo });
      jest.useRealTimers();

      const response = await request(api)
        .post('/video/manage/upload-file/' + testVideo.videoId)
        .attach('file', Buffer.from('abc', 'utf8'), { filename: 'testName' });

      expect(response.status).toBe(201);
      expect(response.body.message).toEqual('uploaded');
      expect(await exists('./base/sub/testName')).toBe(true);
      expect(((await mocked_storage.read('sub/testName')) ?? Buffer.from('')).toString('utf8')).toEqual('abc');
      expect(mocked_db.getMemory().video.items.at(0)?.lastModified?.getTime()).toBeGreaterThanOrEqual(new Date().getTime() - 500);
      expect(mocked_db.getMemory().video.items.at(0)?.lastModified?.getTime()).toBeLessThanOrEqual(new Date().getTime());
    });

    test('uploads file correctly, ts.', async () => {
      const api = buildApi(true);
      mocked_db.getMemory().video.items.push({ ...testVideo });
      jest.useRealTimers();

      const response = await request(api)
        .post('/video/manage/upload-file/' + testVideo.videoId)
        .attach('file', Buffer.from('abc', 'utf8'), { filename: 'testName.ts.enc' });

      expect(response.status).toBe(201);
      expect(response.body.message).toEqual('uploaded');
      expect(await exists('./base/sub/ts/testName.ts.enc')).toBe(true);
      expect(((await mocked_storage.read('sub/ts/testName.ts.enc')) ?? Buffer.from('')).toString('utf8')).toEqual('abc');
      expect(mocked_db.getMemory().video.items.at(0)?.lastModified?.getTime()).toBeGreaterThanOrEqual(new Date().getTime() - 500);
      expect(mocked_db.getMemory().video.items.at(0)?.lastModified?.getTime()).toBeLessThanOrEqual(new Date().getTime());
    });

    test('responses error if video does not exist.', async () => {
      const api = buildApi(true);
      mocked_db.getMemory().video.items.push({ ...testVideo });
      jest.useRealTimers();

      const response = await request(api)
        .post('/video/manage/upload-file/other')
        .attach('file', Buffer.from('abc', 'utf8'), { filename: 'testName' });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('no-such-video');
      expect(await exists('./base/sub/testName')).toBe(false);
      expect(mocked_db.getMemory().video.items.at(0)?.lastModified).toEqual(new Date(0));
    });
  });

  describe('removeTsFilesHandler', () => {
    test('removes ts files correctly.', async () => {
      const api = buildApi(true);
      mocked_db.getMemory().video.items.push({ ...testVideo });
      await mkdir('./base/sub/ts', { recursive: true });
      await writeFile('./base/sub/test1', Buffer.from(''));
      await writeFile('./base/sub/test2', Buffer.from(''));
      await writeFile('./base/sub/ts/file1', Buffer.from(''));
      await writeFile('./base/sub/ts/file2', Buffer.from(''));

      const response = await request(api).delete('/video/manage/delete-ts-files/' + testVideo.videoId);

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('removed');
      expect(await exists('./base/sub/ts')).toBe(false);
      expect(await exists('./base/sub/test1')).toBe(true);
      expect(await exists('./base/sub/test2')).toBe(true);
      expect(mocked_db.getMemory().video.items.at(0)?.lastModified).toEqual(expectedDate);
    });

    test('responses error if video does not exist.', async () => {
      const api = buildApi(true);
      mocked_db.getMemory().video.items.push({ ...testVideo });
      await mkdir('./base/sub/ts', { recursive: true });
      await writeFile('./base/sub/test1', Buffer.from(''));
      await writeFile('./base/sub/test2', Buffer.from(''));
      await writeFile('./base/sub/ts/file1', Buffer.from(''));
      await writeFile('./base/sub/ts/file2', Buffer.from(''));

      const response = await request(api).delete('/video/manage/delete-ts-files/other');

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('no-such-video');
      expect(await exists('./base/sub/ts/file1')).toBe(true);
      expect(await exists('./base/sub/ts/file2')).toBe(true);
      expect(await exists('./base/sub/test1')).toBe(true);
      expect(await exists('./base/sub/test2')).toBe(true);
      expect(mocked_db.getMemory().video.items.at(0)?.lastModified).toEqual(new Date(0));
    });
  });

  describe('downloadHandlers', () => {
    test('downloadThumbnailHandler downloads thumbnail correctly.', async () => {
      const api = buildApi(false);
      await mkdir('./base/sub', { recursive: true });
      await writeFile('./base/sub/thumbnail.jpg.enc', Buffer.from('test-content'));

      const response = await request(api)
        .get('/video/thumbnail/' + testVideo.filesPrefix)
        .buffer()
        .parse((res, callback) => {
          res.setEncoding('binary');
          (res as unknown as Record<string, unknown>).data = '';
          res.on('data', (chunk) => {
            (res as unknown as Record<string, unknown>).data += chunk;
          });
          res.on('end', () => {
            callback(null, Buffer.from((res as unknown as Record<string, unknown>).data as string, 'binary'));
          });
        });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/jpg');
      expect(response.headers['content-length']).toBe('12');
      expect(response.headers['content-disposition']).toBe('attachment; filename=thumbnail.jpg.enc');
      expect(response.body).toEqual(Buffer.from('test-content', 'utf8'));
    });

    test('downloadM3u8Handler downloads m3u8 correctly.', async () => {
      const api = buildApi(false);
      await mkdir('./base/sub', { recursive: true });
      await writeFile('./base/sub/index.m3u8.enc', Buffer.from('test-content'));

      const response = await request(api)
        .get('/video/m3u8/' + testVideo.filesPrefix)
        .buffer()
        .parse((res, callback) => {
          res.setEncoding('binary');
          (res as unknown as Record<string, unknown>).data = '';
          res.on('data', (chunk) => {
            (res as unknown as Record<string, unknown>).data += chunk;
          });
          res.on('end', () => {
            callback(null, Buffer.from((res as unknown as Record<string, unknown>).data as string, 'binary'));
          });
        });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/x-mpegURL');
      expect(response.headers['content-length']).toBe('12');
      expect(response.headers['content-disposition']).toBe('attachment; filename=index.m3u8.enc');
      expect(response.body).toEqual(Buffer.from('test-content', 'utf8'));
    });

    test('downloadTsHandler downloads ts file correctly.', async () => {
      const api = buildApi(false);
      await mkdir('./base/sub/ts', { recursive: true });
      await writeFile('./base/sub/ts/007.ts.enc', Buffer.from('test-content'));

      const response = await request(api)
        .get(`/video/ts/${testVideo.filesPrefix}/007.ts.enc`)
        .buffer()
        .parse((res, callback) => {
          res.setEncoding('binary');
          (res as unknown as Record<string, unknown>).data = '';
          res.on('data', (chunk) => {
            (res as unknown as Record<string, unknown>).data += chunk;
          });
          res.on('end', () => {
            callback(null, Buffer.from((res as unknown as Record<string, unknown>).data as string, 'binary'));
          });
        });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('video/mp2t');
      expect(response.headers['content-length']).toBe('12');
      expect(response.headers['content-disposition']).toBe('attachment; filename=007.ts.enc');
      expect(response.body).toEqual(Buffer.from('test-content', 'utf8'));
    });
  });
});
