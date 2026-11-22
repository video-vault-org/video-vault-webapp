import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FastifyInstance } from 'fastify';
import { createApp } from '@/http/app';
import { parseByteRange } from '@/http/byteRange';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';
import { StorageWrapper } from '@/storage/StorageWrapper';
import { VideoService } from '@/service/VideoService';
import { UserService } from '@/service/UserService';
import { CommentService } from '@/service/CommentService';
import { AuthService } from '@/service/AuthService';

describe('authenticated media range and offline catalog endpoints', () => {
  let app: FastifyInstance, directory: string, db: InMemoryDatabaseAdapter;
  const headers = { authorization: 'Bearer reader' };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vault-media-'));
    db = new InMemoryDatabaseAdapter();
    const storage = new InMemoryStorageAdapter();
    await writeFile(join(directory, 'seed'), Buffer.from([0, 1, 2, 3, 4]));
    await storage.save(join(directory, 'seed'), 'v1.video');
    await db.postVideo({ deleted: false, videoId: 'v1', title: 'encrypted', description: 'encrypted', meta: {}, recorded: new Date(0), lastModified: new Date(1), hmac: 'hmac', videoMimeType: 'video/mp4', thumbnailMimeType: 'image/png' });
    const auth = {
      authenticate: jest.fn(async ({ token }: { token: string }) => (['reader', 'editor'].includes(token) ? { userId: token, admin: false, editor: token === 'editor', moderator: false } : null)),
      authorize: jest.fn((user: { editor: boolean }) => (user.editor ? ['editor'] : []))
    } as unknown as AuthService;
    app = createApp(
      { auth, users: new UserService(db), videos: new VideoService(new StorageWrapper(storage), db), comments: new CommentService(db) },
      { instanceSalt: 'ab'.repeat(32), staticDirectory: directory, temporaryDirectory: directory, logger: false }
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  test('sync returns permanent unverified tombstones without needing a full catalog scan', async () => {
    const full = jest.spyOn(db, 'findAllVideos').mockRejectedValue(new Error('Full scans are not allowed'));
    const lastModified = '2026-11-01T00:00:00.000Z';
    const editor = { authorization: 'Bearer editor' };
    expect((await app.inject({ method: 'DELETE', url: '/api/video/delete/v1', headers, payload: { lastModified } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/api/video/delete/v1', headers: editor, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/api/video/delete/v1', headers: editor, payload: { lastModified } })).statusCode).toBe(204);
    const sync = await app.inject({ url: `/api/video/${Date.parse(lastModified)}`, headers });
    expect(sync.statusCode).toBe(200);
    expect(sync.json()).toEqual([{ videoId: 'v1', deleted: true, title: '', description: '', meta: {}, videoMimeType: '', thumbnailMimeType: '', recorded: '1970-01-01T00:00:00.000Z', lastModified, hmac: '' }]);
    expect((await app.inject({ method: 'DELETE', url: '/api/video/delete/v1', headers: editor, payload: { lastModified: '2026-11-02T00:00:00.000Z' } })).statusCode).toBe(204);
    expect((await db.findOneVideoByVideoId({ videoId: 'v1' }))?.lastModified).toEqual(new Date(lastModified));
    expect(full).not.toHaveBeenCalled();
  });

  test('deleted video IDs cannot be read, changed, commented on or reused', async () => {
    await db.postComment({ commentId: 'c1', videoId: 'v1', userId: 'reader', content: 'encrypted', created: new Date(1), lastModified: new Date(1), edited: false, deleted: false, hmac: 'hmac' });
    await db.deleteVideoByVideoId({ videoId: 'v1', lastModified: new Date(2) });
    const editor = { authorization: 'Bearer editor' };
    for (const url of ['/api/video/file/v1', '/api/video/thumbnail/v1', '/api/video/find/v1', '/api/comments/v1', '/api/comment/find/c1']) {
      expect((await app.inject({ url, headers: editor })).statusCode).toBe(404);
    }
    expect(
      (await app.inject({ method: 'POST', url: '/api/comment/submit', headers, payload: { commentId: 'c2', videoId: 'v1', content: 'encrypted', created: new Date(3).toISOString(), lastModified: new Date(3).toISOString(), hmac: 'hmac' } })).statusCode
    ).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: '/api/comment/change/own/c1', headers, payload: { content: 'changed', lastModified: new Date(3).toISOString(), hmac: 'hmac' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'HEAD', url: '/api/video/file/v1', headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: '/api/video/change/title/v1', headers: editor, payload: { title: 'Changed', lastModified: new Date(3).toISOString(), hmac: 'hmac' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/video/upload/v1', headers: editor })).statusCode).toBe(409);
    const payload = {
      videoId: 'v1',
      deleted: false,
      title: 'encrypted',
      description: 'encrypted',
      meta: {},
      videoMimeType: 'video/mp4',
      thumbnailMimeType: 'image/png',
      recorded: new Date(0).toISOString(),
      lastModified: new Date(3).toISOString(),
      hmac: 'hmac'
    };
    expect((await app.inject({ method: 'POST', url: '/api/video/submit', headers: editor, payload })).statusCode).toBe(409);
    expect((await app.inject({ url: '/api/video/all', headers: editor })).json()).toEqual([]);
  });

  test('HEAD reports size without a response body and remains authenticated', async () => {
    expect((await app.inject({ method: 'HEAD', url: '/api/video/file/v1' })).statusCode).toBe(401);
    const result = await app.inject({ method: 'HEAD', url: '/api/video/file/v1', headers });
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-length']).toBe('5');
    expect(result.headers['accept-ranges']).toBe('bytes');
    expect(result.body).toBe('');
  });

  test.each([
    ['bytes=1-3', 1, 3],
    ['bytes=3-', 3, 4],
    ['bytes=-2', 3, 4],
    ['bytes=3-99', 3, 4]
  ] as const)('serves %s as inclusive HTTP 206', async (header, from, to) => {
    const result = await app.inject({ url: '/api/video/file/v1', headers: { ...headers, range: header } });
    expect(result.statusCode).toBe(206);
    expect(result.headers['content-range']).toBe(`bytes ${from}-${to}/5`);
    expect(result.rawPayload).toEqual(Buffer.from([0, 1, 2, 3, 4]).subarray(from, to + 1));
  });

  test.each(['bytes=5-', 'bytes=3-2', 'bytes=-0', 'bytes=1-2,3-4', 'bytes=-', 'items=0-1'])('rejects %s with size in Content-Range', async (range) => {
    const result = await app.inject({ url: '/api/video/file/v1', headers: { ...headers, range } });
    expect(result.statusCode).toBe(416);
    expect(result.headers['content-range']).toBe('bytes */5');
  });

  test('rejects ambiguous query/header bounds, preserves query ranges and handles missing videos', async () => {
    expect((await app.inject({ url: '/api/video/file/v1?from=0', headers: { ...headers, range: 'bytes=0-1' } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/video/file/v1?from=0&to=1', headers })).rawPayload).toEqual(Buffer.from([0, 1]));
    expect((await app.inject({ method: 'HEAD', url: '/api/video/file/unknown', headers })).statusCode).toBe(404);
  });

  test('range parsing rejects unsafe integers and empty files', () => {
    expect(() => parseByteRange('bytes=99999999999999999999-', 5)).toThrow(RangeError);
    expect(() => parseByteRange('bytes=0-', 0)).toThrow(RangeError);
  });
});
