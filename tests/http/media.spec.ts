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
    await db.postVideo({ videoId: 'v1', title: 'encrypted', description: 'encrypted', meta: {}, recorded: new Date(0), lastModified: new Date(1), hmac: 'hmac', videoMimeType: 'video/mp4', thumbnailMimeType: 'image/png' });
    const auth = { authenticate: jest.fn(async ({ token }: { token: string }) => (token === 'reader' ? { userId: 'reader', admin: false, editor: false, moderator: false } : null)), authorize: jest.fn(() => []) } as unknown as AuthService;
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
  test('catalog is available to any authenticated reader, contains only IDs and reflects deletions', async () => {
    const ids = jest.spyOn(db, 'findAllVideoIds');
    const full = jest.spyOn(db, 'findAllVideos').mockRejectedValue(new Error('Full video loading is not allowed'));
    expect((await app.inject({ url: '/api/video/catalog' })).statusCode).toBe(401);
    expect(ids).not.toHaveBeenCalled();
    expect((await app.inject({ url: '/api/video/catalog', headers })).json()).toEqual(['v1']);
    await db.deleteVideoByVideoId({ videoId: 'v1' });
    expect((await app.inject({ url: '/api/video/catalog', headers })).json()).toEqual([]);
    expect(ids).toHaveBeenCalledTimes(2);
    expect(full).not.toHaveBeenCalled();
  });
  test('catalog reports a failed ID query as an error instead of an empty catalog', async () => {
    jest.spyOn(db, 'findAllVideoIds').mockRejectedValueOnce(new Error('Database unavailable'));
    expect((await app.inject({ url: '/api/video/catalog', headers })).statusCode).toBe(500);
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
