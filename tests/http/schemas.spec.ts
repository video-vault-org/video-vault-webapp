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
import { DEFAULT_META_CONFIG } from '@/meta/config/MetaConfig';

const account: User = { userId: 'admin', username: 'alice', displayName: 'Alice', loginHash: 'private-hash', passwordKeySalt: 'salt', userKey: 'wrapped-key', admin: true, editor: true, moderator: true };
const video = {
  deleted: false,
  videoId: 'video',
  title: 'Video',
  description: 'Encrypted description',
  meta: { duration: 10, nested: { custom: true } },
  videoMimeType: 'video/mp4',
  thumbnailMimeType: 'image/png',
  recorded: new Date(50),
  lastModified: new Date('2026-01-01T00:00:00Z'),
  hmac: 'hmac'
};

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
    app = createApp({ auth, users, videos, comments }, { instanceSalt: 'ab'.repeat(32), logger: false });
  });

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  const headers = { authorization: 'Bearer token' };

  test.each([{ username: 'alice', loginHash: 123 }, { username: 'alice', loginHash: 'hash', admin: true }, { username: '', loginHash: 'hash' }, { username: 'ab', loginHash: 'hash' }, { username: 'alice' }])(
    'rejects invalid login bodies without calling the service (%j)',
    async (payload) => {
      const login = jest.spyOn(auth, 'login');
      const response = await app.inject({ method: 'POST', url: '/login', payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Invalid request' });
      expect(login).not.toHaveBeenCalled();
    }
  );

  test('rejects usernames shorter than three characters when creating or renaming accounts', async () => {
    const create = jest.spyOn(users, 'createUser');
    const rename = jest.spyOn(users, 'changeUsersUsername');
    const invalid = { ...account, userId: 'new-user', username: 'ab' };
    expect((await app.inject({ method: 'POST', url: '/api/user/add', headers, payload: invalid })).statusCode).toBe(400);
    for (const url of ['/api/user/change/username/ab', '/api/user/change/username/admin/ab']) {
      expect((await app.inject({ method: 'PATCH', url, headers, payload: { loginHash: 'new-hash' } })).statusCode).toBe(400);
    }
    expect(create).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  test('accepts three-character usernames in both own and admin rename routes', async () => {
    await db.createUser(account);
    expect((await app.inject({ method: 'PATCH', url: '/api/user/change/username/abc', headers, payload: { loginHash: 'new-hash' } })).statusCode).toBe(204);
    expect((await db.findOneUserByUserId({ userId: account.userId }))?.username).toBe('abc');
    expect((await app.inject({ method: 'PATCH', url: '/api/user/change/username/admin/xyz', headers, payload: { loginHash: 'new-hash' } })).statusCode).toBe(204);
    expect((await db.findOneUserByUserId({ userId: account.userId }))?.username).toBe('xyz');
  });

  test.each([undefined, {}, { loginHash: '' }, { loginHash: 123 }, { loginHash: 'x'.repeat(4097) }, { loginHash: 'hash', unknown: true }])('rejects invalid username-change bodies without updating the account (%j)', async (payload) => {
    await db.createUser(account);
    const rename = jest.spyOn(users, 'changeUsersUsername');
    for (const url of ['/api/user/change/username/renamed', '/api/user/change/username/admin/renamed']) {
      const response = await app.inject({ method: 'PATCH', url, headers, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Invalid request' });
    }
    expect(rename).not.toHaveBeenCalled();
    expect(await db.findOneUserByUserId({ userId: account.userId })).toEqual(account);
  });

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

  test.each([{ description: undefined }, { description: '' }, { description: 123 }, { recorded: undefined }, { recorded: 'invalid' }, { recorded: '2026-02-30T00:00:00Z' }])(
    'requires a description and valid recording timestamp when submitting a video (%j)',
    async (changes) => {
      const submit = jest.spyOn(videos, 'submitVideo');
      const response = await app.inject({ method: 'POST', url: '/api/video/submit', headers, payload: { ...video, ...changes } });
      expect(response.statusCode).toBe(400);
      expect(submit).not.toHaveBeenCalled();
    }
  );

  test.each([
    ['description', {}],
    ['description', { description: '' }],
    ['description', { description: 123 }],
    ['description', { description: 'a'.repeat(1_000_001) }],
    ['recorded', {}],
    ['recorded', { recorded: 123 }],
    ['recorded', { recorded: 'invalid' }],
    ['recorded', { recorded: '2026-02-30T00:00:00Z' }]
  ] as const)('rejects invalid %s changes before calling the service', async (field, values) => {
    const description = jest.spyOn(videos, 'changeVideosDescription');
    const recorded = jest.spyOn(videos, 'changeVideosRecorded');
    const response = await app.inject({ method: 'PATCH', url: `/api/video/change/${field}/video`, headers, payload: { lastModified: '2026-01-01T00:00:00Z', hmac: 'hmac', ...values } });
    expect(response.statusCode).toBe(400);
    expect(description).not.toHaveBeenCalled();
    expect(recorded).not.toHaveBeenCalled();
  });

  test('frontend metadata field definitions do not restrict the existing arbitrary-JSON metadata API', async () => {
    await app.close();
    const find = jest.spyOn(videos, 'findVideo').mockResolvedValue(video);
    const change = jest.spyOn(videos, 'changeVideosMetadata').mockResolvedValue(undefined);
    app = createApp(
      { auth, users, videos, comments },
      { instanceSalt: 'ab'.repeat(32), logger: false, metaConfig: { ...DEFAULT_META_CONFIG, fields: [{ key: 'count', name: 'Count', type: 'number', multiple: false, required: true, showInDetails: true, useAsFilter: true }] } }
    );
    const metadata = { anything: ['arbitrary', { nested: true }] };
    const response = await app.inject({ method: 'PATCH', url: '/api/video/change/metadata/video', headers, payload: { metadata, lastModified: '2026-01-01T00:00:00Z', hmac: 'hmac' } });
    expect(response.statusCode).toBe(204);
    expect(find).toHaveBeenCalledWith({ videoId: 'video' });
    expect(change).toHaveBeenCalledWith({ videoId: 'video', metadata, lastModified: new Date('2026-01-01T00:00:00Z'), hmac: 'hmac' });
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
    expect(response.json()).toEqual([{ ...video, recorded: video.recorded.toISOString(), lastModified: video.lastModified.toISOString() }]);
    expect(response.body).not.toContain('internal-secret');
  });

  test('clients cannot submit a new video already marked as deleted', async () => {
    const submit = jest.spyOn(videos, 'submitVideo');
    const response = await app.inject({ method: 'POST', url: '/api/video/submit', headers, payload: { ...video, deleted: true, recorded: video.recorded.toISOString(), lastModified: video.lastModified.toISOString() } });
    expect(response.statusCode).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  test('sync schemas accept cleared tombstones but reject inconsistent tombstone responses', async () => {
    const tombstone = { ...video, deleted: true, title: '', description: '', meta: {}, videoMimeType: '', thumbnailMimeType: '', recorded: new Date(0), hmac: '' };
    const find = jest.spyOn(videos, 'findVideosLastModified').mockResolvedValueOnce([tombstone]);
    const response = await app.inject({ url: '/api/video/0', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ ...tombstone, recorded: new Date(0).toISOString(), lastModified: video.lastModified.toISOString() }]);
    find.mockResolvedValueOnce([{ ...tombstone, title: 'uncleared' }]);
    expect((await app.inject({ url: '/api/video/0', headers })).statusCode).toBe(500);
  });
});
