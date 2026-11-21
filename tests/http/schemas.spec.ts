import { FastifyInstance } from 'fastify';
import { createApp } from '@/http/app';
import { AuthService } from '@/service/AuthService';
import { UserService } from '@/service/UserService';
import { VideoService } from '@/service/VideoService';
import { CommentService } from '@/service/CommentService';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';
import { StorageWrapper } from '@/storage/StorageWrapper';
import { User } from '@/domain/User';

const account: User = { userId: 'admin', username: 'alice', displayName: 'Alice', loginHash: 'private-hash', passwordKeySalt: 'salt', userKey: 'wrapped-key', admin: true, editor: true, moderator: true };
const video = { videoId: 'video', title: 'Video', meta: { duration: 10, nested: { custom: true } }, videoMimeType: 'video/mp4', thumbnailMimeType: 'image/png', lastModified: new Date('2026-01-01T00:00:00Z'), hmac: 'hmac' };

describe('compiled Fastify request and response schemas', () => {
  let app: FastifyInstance;
  let auth: AuthService;
  let users: UserService;
  let videos: VideoService;
  let comments: CommentService;
  let db: InMemoryDatabaseAdapter;
  beforeEach(() => {
    db = new InMemoryDatabaseAdapter();
    auth = new AuthService(db);
    users = new UserService(db);
    videos = new VideoService(new StorageWrapper(new InMemoryStorageAdapter()), db);
    comments = new CommentService(db);
    jest.spyOn(auth, 'authenticate').mockResolvedValue(account);
    app = createApp({ auth, users, videos, comments }, { logger: false });
  });
  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
  });
  const headers = { authorization: 'Bearer token' };

  test.each([{ username: 'alice', loginHash: 123 }, { username: 'alice', loginHash: 'hash', admin: true }, { username: '', loginHash: 'hash' }, { username: 'alice' }])(
    'rejects invalid login bodies without calling the service (%j)',
    async (payload) => {
      const login = jest.spyOn(auth, 'login');
      const response = await app.inject({ method: 'POST', url: '/login', payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Invalid request' });
      expect(login).not.toHaveBeenCalled();
    }
  );

  test('rejects boolean strings and unknown request fields instead of coercing or discarding them', async () => {
    const change = jest.spyOn(users, 'changeUsersAdminRole');
    for (const payload of [{ admin: 'false' }, { admin: false, unknown: true }]) {
      expect((await app.inject({ method: 'PATCH', url: '/api/user/change/admin/admin', headers, payload })).statusCode).toBe(400);
    }
    expect(change).not.toHaveBeenCalled();
  });

  test('validates calendar dates, metadata objects and identifier syntax before service calls', async () => {
    const submit = jest.spyOn(videos, 'submitVideo');
    for (const payload of [
      { ...video, lastModified: '2026-02-30T00:00:00Z' },
      { ...video, meta: [] },
      { ...video, videoId: '../escape' }
    ]) {
      expect((await app.inject({ method: 'POST', url: '/api/video/submit', headers, payload })).statusCode).toBe(400);
    }
    expect(submit).not.toHaveBeenCalled();
  });

  test('coerces query numbers only and supplies pagination defaults', async () => {
    const find = jest.spyOn(comments, 'findCommentsByVideoIdSortedByCreatedDescPaginated').mockResolvedValue([[], '']);
    expect((await app.inject({ url: '/api/comments/video', headers })).statusCode).toBe(200);
    expect(find).toHaveBeenLastCalledWith({ videoId: 'video', paginationCursor: '', paginationSize: 100 });
    expect((await app.inject({ url: '/api/comments/video?pagesize=5&cursor=next', headers })).statusCode).toBe(200);
    expect(find).toHaveBeenLastCalledWith({ videoId: 'video', paginationCursor: 'next', paginationSize: 5 });
    for (const query of ['pagesize=1.5', 'pagesize=1001', 'pagesize=0', 'pagesize=abc', 'pagesize=1&pagesize=2', 'unknown=true']) {
      expect((await app.inject({ url: `/api/comments/video?${query}`, headers })).statusCode).toBe(400);
    }
  });

  test('authentication and authorization run before body validation', async () => {
    jest.mocked(auth.authenticate).mockResolvedValueOnce(null);
    expect((await app.inject({ method: 'POST', url: '/api/user/add', headers, payload: { invalid: true } })).statusCode).toBe(401);
    jest.mocked(auth.authenticate).mockResolvedValueOnce({ ...account, admin: false });
    expect((await app.inject({ method: 'POST', url: '/api/user/add', headers, payload: { invalid: true } })).statusCode).toBe(403);
  });

  test('defaults omitted role flags to false when creating a user', async () => {
    const create = jest.spyOn(users, 'createUser').mockResolvedValue(undefined);
    const { loginHash: _hash, admin: _admin, editor: _editor, moderator: _moderator, ...fields } = account;
    const response = await app.inject({ method: 'POST', url: '/api/user/add', headers, payload: { ...fields, loginHash: 'client-hash' } });
    expect(response.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith({ ...fields, loginHash: 'client-hash', admin: false, editor: false, moderator: false });
  });

  test('compiled user response schemas strip sensitive and unexpected fields from nested lists', async () => {
    const extra = { ...account, unexpectedSecret: 'do-not-send' };
    jest.spyOn(users, 'findAllUsers').mockResolvedValue([extra]);
    const response = await app.inject({ url: '/api/user/all', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).toMatchObject({ userId: 'admin', username: 'alice', userKey: 'wrapped-key' });
    expect(response.body).not.toContain('loginHash');
    expect(response.body).not.toContain('do-not-send');
  });

  test('missing required response properties produce a generic 500 rather than an invalid successful response', async () => {
    jest.spyOn(users, 'findAllUsers').mockResolvedValue([{ userId: 'broken' } as User]);
    const response = await app.inject({ url: '/api/user/all', headers });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'Internal server error' });
  });

  test('video responses preserve arbitrary metadata and encode dates while dropping undeclared properties', async () => {
    const extra = { ...video, privateInternalField: 'internal-secret' };
    jest.spyOn(videos, 'findAllVideos').mockResolvedValue([extra]);
    const response = await app.inject({ url: '/api/video/all', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ ...video, lastModified: video.lastModified.toISOString() }]);
    expect(response.body).not.toContain('internal-secret');
  });
});
