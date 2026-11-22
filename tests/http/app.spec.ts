import { FastifyInstance } from 'fastify';
import request from 'supertest';
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { AuthService } from '@/service/AuthService';
import { UserService } from '@/service/UserService';
import { VideoService } from '@/service/VideoService';
import { CommentService } from '@/service/CommentService';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';
import { StorageWrapper } from '@/storage/StorageWrapper';
import { User } from '@/domain/User';
import { createApp } from '@/http/app';
import { hashPassword, verifyPassword } from '@/util/password';
import { deriveKey } from '@/util/deriveKey';

const instant = '2026-01-01T00:00:00.000Z';
const video = { videoId: 'v1', title: 'Video', description: 'Encrypted description', meta: { duration: 10 }, videoMimeType: 'video/mp4', thumbnailMimeType: 'image/png', recorded: new Date(50), lastModified: new Date(instant), hmac: 'video-hmac' };
const change = { lastModified: instant, hmac: 'changed-hmac' };
const loginHash = Buffer.from('client-password-hash').toString('base64');
const password = { loginHash, passwordKeySalt: 'salt', userKey: 'encrypted-key' };
const comment = { commentId: 'c1', videoId: 'v1', userId: 'reader', content: 'Comment', created: new Date(instant), lastModified: new Date(instant), hmac: 'comment-hmac', edited: false, deleted: false };
const commentBody = { commentId: 'new-comment', videoId: 'v1', content: 'New comment', created: instant, lastModified: instant, hmac: 'new-hmac' };
type Role = 'reader' | 'admin' | 'editor' | 'moderator' | 'editor2' | 'target';

// Each entry checks every role and an unauthenticated request against the same real route.
const protectedRoutes = [
  ['post', '/api/user/add', 'admin', { ...password, userId: 'new-user', username: 'new-user', displayName: 'New User' }, 201],
  ['get', '/api/user/all', 'admin', undefined, 200],
  ['get', '/api/user/find/target', 'admin', undefined, 200],
  ['patch', '/api/user/change/displayname/target/Changed', 'admin', undefined, 204],
  ['patch', '/api/user/change/username/target/renamed', 'admin', { loginHash }, 204],
  ['patch', '/api/user/change/password/target', 'admin', password, 204],
  ['patch', '/api/user/change/admin/target', 'admin', { admin: true }, 204],
  ['patch', '/api/user/change/editor/target', 'admin', { editor: true }, 204],
  ['patch', '/api/user/change/moderator/target', 'admin', { moderator: true }, 204],
  ['delete', '/api/user/delete/target', 'admin', undefined, 204],
  ['get', '/api/user/me', 'any', undefined, 200],
  ['patch', '/api/user/change/displayname/Changed', 'any', undefined, 204],
  ['patch', '/api/user/change/username/renamed', 'any', { loginHash }, 204],
  ['patch', '/api/user/change/password', 'any', password, 204],
  ['delete', '/api/user/delete', 'any', undefined, 204],
  ['post', '/api/video/upload/new-video', 'editor', undefined, 400],
  ['post', '/api/video/submit', 'editor', { ...video, videoId: 'new-video' }, 404],
  ['get', '/api/video/all', 'editor', undefined, 200],
  ['get', '/api/video/find/v1', 'editor', undefined, 200],
  ['patch', '/api/video/change/title/v1', 'editor', { ...change, title: 'Changed' }, 204],
  ['patch', '/api/video/change/description/v1', 'editor', { ...change, description: 'Changed encrypted description' }, 204],
  ['patch', '/api/video/change/metadata/v1', 'editor', { ...change, metadata: { duration: 20 } }, 204],
  ['post', '/api/video/upload/v1', 'editor', undefined, 400],
  ['patch', '/api/video/change/files/v1', 'editor', { ...change, videoMimeType: 'video/webm' }, 404],
  ['patch', '/api/video/change/recorded/v1', 'editor', { ...change, recorded: '2025-03-12T10:20:30+02:00' }, 204],
  ['delete', '/api/video/delete/v1', 'editor', undefined, 204],
  ['get', '/api/video/0', 'any', undefined, 200],
  ['get', '/api/video/file/v1', 'any', undefined, 200],
  ['get', '/api/video/thumbnail/v1', 'any', undefined, 200],
  ['get', '/api/comments/v1', 'any', undefined, 200],
  ['get', '/api/comment/find/c1', 'any', undefined, 200],
  ['post', '/api/comment/submit', 'any', commentBody, 201],
  ['patch', '/api/comment/change/own/c1', 'own', { ...change, content: 'Changed' }, 204],
  ['delete', '/api/comment/delete/own/c1', 'own', undefined, 204],
  ['patch', '/api/comment/change/c1', 'moderator', { ...change, content: 'Changed' }, 204],
  ['delete', '/api/comment/delete/c1', 'moderator', undefined, 204]
] as const;

describe('Fastify backend', () => {
  jest.setTimeout(30_000);
  const db = new InMemoryDatabaseAdapter();
  let auth: AuthService;
  let users: UserService;
  let videos: VideoService;
  let comments: CommentService;
  let app: FastifyInstance;
  let root: string;
  let directory: string;
  let temporaryDirectory: string;
  let staticDirectory: string;
  let storedHash: string;
  const tokens = {} as Record<Role, string>;

  const makeUser = (name: Role): User => ({
    userId: name,
    username: name,
    displayName: name,
    loginHash: storedHash,
    passwordKeySalt: 'salt',
    userKey: 'encrypted-key',
    admin: name === 'admin',
    editor: name === 'editor' || name === 'editor2',
    moderator: name === 'moderator'
  });

  const headers = (role: Role = 'reader') => ({ Authorization: `Bearer ${tokens[role]}` });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'video-vault-http-'));
    storedHash = await hashPassword(loginHash);
    auth = new AuthService(db, { keyDirectory: join(root, 'jwtkeys') });
    await auth.initialize();
    for (const name of ['reader', 'admin', 'editor', 'moderator', 'editor2', 'target'] as const) {
      await db.createUser(makeUser(name));
      tokens[name] = (await auth.login({ username: name, loginHash }))!;
    }
  });

  beforeEach(async () => {
    await db.initialize();
    for (const name of ['reader', 'admin', 'editor', 'moderator', 'editor2', 'target'] as const) await db.createUser(makeUser(name));
    directory = await mkdtemp(join(root, 'case-'));
    temporaryDirectory = join(directory, 'tmp');
    staticDirectory = join(directory, 'public');
    await mkdir(temporaryDirectory);
    await mkdir(staticDirectory);
    await writeFile(join(staticDirectory, 'index.html'), '<h1>VideoVault</h1>');
    await writeFile(join(staticDirectory, '.secret'), 'private');
    const adapter = new InMemoryStorageAdapter();
    const storage = new StorageWrapper(adapter, { temporaryDirectory });
    await writeFile(join(temporaryDirectory, 'seed'), Buffer.from([0, 1, 128, 255]));
    await adapter.save(join(temporaryDirectory, 'seed'), 'v1.video');
    await adapter.save(join(temporaryDirectory, 'seed'), 'v1.thumbnail');
    await rm(join(temporaryDirectory, 'seed'));
    users = new UserService(db);
    videos = new VideoService(storage, db);
    comments = new CommentService(db);
    app = createApp({ auth, users, videos, comments }, { instanceSalt: 'ab'.repeat(32), staticDirectory, temporaryDirectory, maxVideoBytes: 1024, maxThumbnailBytes: 16 });
    await app.ready();
    await db.postVideo(video);
    await db.postComment(comment);
  });

  afterEach(async () => {
    await app?.close();
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test.each(protectedRoutes)('%s %s enforces its documented access policy', async (method, path, access, body, success) => {
    await request(app.server)[method](path).send(body).expect(401);
    // Own-comment routes use only the logged-in user's identity; other users receive 404.
    for (const role of ['reader', 'admin', 'editor', 'moderator'] as const) {
      const allowed = access === 'any' || access === 'own' || role === access;
      // Mutations within a row use unique values to avoid colliding usernames and comment IDs.
      const url = path === '/api/user/change/username/renamed' ? `/api/user/change/username/renamed-${role}` : path;
      const data = path === '/api/comment/submit' ? { ...commentBody, commentId: `comment-${role}` } : body;
      const expected = !allowed ? 403 : access === 'own' && role !== 'reader' ? 404 : success;
      await request(app.server)[method](url).set(headers(role)).send(data).expect(expected);
    }
  });

  test('updates the encrypted video description together with lastModified and hmac', async () => {
    const description = 'test-description';
    await request(app.server)
      .patch('/api/video/change/description/v1')
      .set(headers('editor'))
      .send({ ...change, description })
      .expect(204);
    expect(await db.findOneVideoByVideoId({ videoId: 'v1' })).toEqual({ ...video, description, lastModified: new Date(change.lastModified), hmac: change.hmac });
    const response = await request(app.server).get('/api/video/find/v1').set(headers('editor')).expect(200);
    expect(response.body).toMatchObject({ description, recorded: video.recorded.toISOString() });
  });

  test('updates recorded as a Date and serializes it as UTC on all video read routes', async () => {
    const recorded = '2025-03-12T10:20:30+02:00';
    await request(app.server)
      .patch('/api/video/change/recorded/v1')
      .set(headers('editor'))
      .send({ ...change, recorded })
      .expect(204);
    expect(await db.findOneVideoByVideoId({ videoId: 'v1' })).toEqual({ ...video, recorded: new Date(recorded), lastModified: new Date(change.lastModified), hmac: change.hmac });
    for (const path of ['/api/video/find/v1', '/api/video/all', '/api/video/0']) {
      const response = await request(app.server).get(path).set(headers('editor')).expect(200);
      const item = Array.isArray(response.body) ? response.body[0] : response.body;
      expect(item).toMatchObject({ description: video.description, recorded: '2025-03-12T08:20:30.000Z', lastModified: change.lastModified });
    }
  });

  test.each([
    ['description', { description: 'Encrypted description' }],
    ['recorded', { recorded: '2025-03-12T10:20:30Z' }]
  ] as const)('returns 404 when changing %s of an unknown video', async (field, values) => {
    await request(app.server)
      .patch(`/api/video/change/${field}/missing`)
      .set(headers('editor'))
      .send({ ...change, ...values })
      .expect(404);
    expect(await db.findOneVideoByVideoId({ videoId: 'missing' })).toBeNull();
  });

  test('login is public, returns a usable JWT and never returns credentials', async () => {
    const result = await request(app.server).post('/login').send({ username: 'reader', loginHash }).expect(200);
    expect(Object.keys(result.body)).toEqual(['token']);
    const me = await request(app.server).get('/api/user/me').set('Authorization', `Bearer ${result.body.token}`).expect(200);
    expect(me.body.userId).toBe('reader');
    expect(me.body).not.toHaveProperty('loginHash');
    expect(me.headers['cache-control']).toBe('no-store');
  });

  test.each(['own', 'admin'] as const)('%s username changes require a new loginHash and preserve the wrapped keys', async (mode) => {
    const userId = mode === 'own' ? 'reader' : 'target';
    const original = (await db.findOneUserByUserId({ userId }))!;
    const username = 'renamed-user';
    const newLoginHash = (await deriveKey('test-password', 'ab'.repeat(32) + username)).toString('base64');
    const url = mode === 'own' ? `/api/user/change/username/${username}` : `/api/user/change/username/${userId}/${username}`;

    await request(app.server)
      .patch(url)
      .set(headers(mode === 'own' ? 'reader' : 'admin'))
      .send({ loginHash: newLoginHash })
      .expect(204);

    const updated = (await db.findOneUserByUserId({ userId }))!;
    expect(updated).toEqual({ ...original, username, loginHash: expect.stringMatching(/^\$scrypt\$/) });
    expect(await verifyPassword(newLoginHash, updated.loginHash)).toBe(true);
    expect(await verifyPassword(loginHash, updated.loginHash)).toBe(false);
    await request(app.server).post('/login').send({ username: original.username, loginHash }).expect(401);
    await request(app.server).post('/login').send({ username, loginHash }).expect(401);
    const result = await request(app.server).post('/login').send({ username, loginHash: newLoginHash }).expect(200);
    const me = await request(app.server).get('/api/user/me').set('Authorization', `Bearer ${result.body.token}`).expect(200);
    expect(me.body).toMatchObject({ userId, username, userKey: original.userKey, passwordKeySalt: original.passwordKeySalt });
    expect(me.body).not.toHaveProperty('loginHash');
  });

  test('login rejects invalid credentials and active locks with the same response', async () => {
    const wrong = Buffer.from('wrong').toString('base64');
    for (let index = 0; index < 5; index++) await request(app.server).post('/login').send({ username: 'reader', loginHash: wrong }).expect(401);
    await request(app.server).post('/login').send({ username: 'reader', loginHash }).expect(401);
    expect(await db.findOneAttemptsCountByUsername({ username: 'reader' })).toMatchObject({ attempts: 5 });
  });

  test.each(['Basic abc', 'Bearer invalid', 'Bearer', 'Bearer a b'])('rejects invalid Authorization %s', async (value) => {
    await request(app.server).get('/api/user/me').set('Authorization', value).expect(401).expect('WWW-Authenticate', 'Bearer');
  });

  test('never includes loginHash in individual or array user responses, including newly created users', async () => {
    for (const path of ['/api/user/me', '/api/user/find/target', '/api/user/all']) {
      const result = await request(app.server).get(path).set(headers('admin')).expect(200);
      expect(JSON.stringify(result.body)).not.toContain('loginHash');
      expect(JSON.stringify(result.body)).not.toContain(storedHash);
    }
    const result = await request(app.server)
      .post('/api/user/add')
      .set(headers('admin'))
      .send({ ...password, userId: 'new', username: 'new', displayName: 'New' })
      .expect(201);
    expect(result.body).not.toHaveProperty('loginHash');
    expect(await verifyPassword(loginHash, (await db.findOneUserByUserId({ userId: 'new' }))!.loginHash)).toBe(true);
  });

  test('own user changes cannot change another user or elevate roles', async () => {
    await request(app.server).patch('/api/user/change/displayname/Own%20Name').set(headers()).send({ userId: 'target', admin: true }).expect(204);
    expect(await db.findOneUserByUserId({ userId: 'reader' })).toMatchObject({ displayName: 'Own Name', admin: false });
    expect(await db.findOneUserByUserId({ userId: 'target' })).toMatchObject({ displayName: 'target', admin: false });
    await request(app.server)
      .patch('/api/user/change/password')
      .set(headers())
      .send({ ...password, admin: true, userId: 'target' })
      .expect(400);
    await request(app.server).patch('/api/user/change/admin/reader').set(headers()).send({ admin: true }).expect(403);
  });

  test('deleting an account clears its comments and invalidates its token', async () => {
    await request(app.server).delete('/api/user/delete').set(headers()).expect(204);
    expect(await db.findOneCommentByCommentId({ commentId: 'c1' })).toMatchObject({ deleted: true, content: '' });
    await request(app.server).get('/api/user/me').set(headers()).expect(401);
  });

  test('role changes take effect on existing JWTs', async () => {
    await request(app.server).get('/api/video/all').set(headers()).expect(403);
    await request(app.server).patch('/api/user/change/editor/reader').set(headers('admin')).send({ editor: true }).expect(204);
    await request(app.server).get('/api/video/all').set(headers()).expect(200);
  });

  test('own comment changes use both IDs and reject foreign comments without mutating them', async () => {
    const own = jest.spyOn(comments, 'changeOwnCommentsContent');
    await request(app.server)
      .patch('/api/comment/change/own/c1')
      .set(headers())
      .send({ ...change, content: 'Own update' })
      .expect(204);
    expect(own).toHaveBeenCalledWith({ commentId: 'c1', userId: 'reader', content: 'Own update', lastModified: new Date(instant), hmac: 'changed-hmac' });
    await request(app.server)
      .patch('/api/comment/change/own/c1')
      .set(headers('editor'))
      .send({ ...change, content: 'Foreign' })
      .expect(404);
    await request(app.server).delete('/api/comment/delete/own/c1').set(headers('editor')).expect(404);
    expect(await db.findOneCommentByCommentId({ commentId: 'c1' })).toMatchObject({ content: 'Own update', edited: true, deleted: false });
  });

  test('moderators can update and soft-delete another user comment', async () => {
    await request(app.server)
      .patch('/api/comment/change/c1')
      .set(headers('moderator'))
      .send({ ...change, content: 'Moderated' })
      .expect(204);
    await request(app.server).delete('/api/comment/delete/c1').set(headers('moderator')).expect(204);
    expect(await db.findOneCommentByCommentId({ commentId: 'c1' })).toMatchObject({ userId: 'reader', deleted: true, content: '' });
  });

  test('comment creation rejects forged author and deletion flags', async () => {
    await request(app.server)
      .post('/api/comment/submit')
      .set(headers())
      .send({ ...commentBody, userId: 'admin', deleted: true })
      .expect(400);
    const result = await request(app.server).post('/api/comment/submit').set(headers()).send(commentBody).expect(201);
    expect(result.body).toMatchObject({ userId: 'reader', deleted: false, edited: false, commentId: 'new-comment' });
    await request(app.server).post('/api/comment/submit').set(headers()).send(commentBody).expect(409);
    await request(app.server)
      .post('/api/comment/submit')
      .set(headers())
      .send({ ...commentBody, commentId: 'missing-video', videoId: 'missing' })
      .expect(404);
  });

  test('comment pagination sorts, forwards opaque cursors and returns an empty last cursor', async () => {
    await db.postComment({ ...comment, commentId: 'newer', created: new Date('2026-02-01T00:00:00Z') });
    await db.postComment({ ...comment, commentId: 'other-video', videoId: 'v2', created: new Date('2026-03-01T00:00:00Z') });
    const first = await request(app.server).get('/api/comments/v1?pagesize=1').set(headers()).expect(200);
    expect(first.body.comments.map((item: { commentId: string }) => item.commentId)).toEqual(['newer']);
    expect(first.body.cursor).not.toBe('');
    const last = await request(app.server).get('/api/comments/v1').query({ pagesize: 1, cursor: first.body.cursor }).set(headers()).expect(200);
    expect(last.body.comments.map((item: { commentId: string }) => item.commentId)).toEqual(['c1']);
    expect(last.body.cursor).toBe('');
    const find = jest.spyOn(comments, 'findCommentsByVideoIdSortedByCreatedDescPaginated');
    await request(app.server).get('/api/comments/empty').set(headers()).expect(200, { comments: [], cursor: '' });
    expect(find).toHaveBeenCalledWith({ videoId: 'empty', paginationSize: 100, paginationCursor: '' });
  });

  test.each(['pagesize=0', 'pagesize=1001', 'pagesize=1.5', 'pagesize=x', 'cursor=x&cursor=y', 'unknown=x'])('rejects invalid pagination %s', async (query) => {
    await request(app.server).get(`/api/comments/v1?${query}`).set(headers()).expect(400);
  });

  test('returns 400 when an adapter rejects an opaque pagination cursor', async () => {
    jest.spyOn(comments, 'findCommentsByVideoIdSortedByCreatedDescPaginated').mockRejectedValueOnce(new RangeError('Invalid DynamoDB comment cursor'));
    await request(app.server).get('/api/comments/v1?cursor=invalid').set(headers()).expect(400, { error: 'Invalid pagination cursor' });
  });

  test('video dates support ISO and milliseconds, and reject invalid dates', async () => {
    await request(app.server)
      .get(`/api/video/${encodeURIComponent(instant)}`)
      .set(headers())
      .expect(200);
    await request(app.server)
      .get(`/api/video/${new Date(instant).getTime() + 1}`)
      .set(headers())
      .expect(200, []);
    await request(app.server).get('/api/video/not-a-date').set(headers()).expect(400);
  });

  test('video and thumbnail downloads are authenticated binary reads with inclusive bounds', async () => {
    const bytes = await request(app.server)
      .get('/api/video/file/v1?from=1&to=2')
      .set(headers())
      .expect(200)
      .expect('Content-Type', /octet-stream/);
    expect(bytes.body).toEqual(Buffer.from([1, 128]));
    const thumb = await request(app.server).get('/api/video/thumbnail/v1').set(headers()).expect(200);
    expect(thumb.body).toEqual(Buffer.from([0, 1, 128, 255]));
    await request(app.server).get('/api/video/file/v1?from=5').set(headers()).expect(416);
    await request(app.server).get('/api/video/file/v1?from=3&to=1').set(headers()).expect(416);
    await request(app.server).get('/api/video/file/v1?from=-1').set(headers()).expect(400);
    await request(app.server).get('/api/video/file/v1?from=1&from=2').set(headers()).expect(400);
  });

  const upload = async function (videoId = 'upload', role: Role = 'editor', bytes = Buffer.from([0, 128, 255]), thumbnail = Buffer.from([42])) {
    return request(app.server).post(`/api/video/upload/${videoId}`).set(headers(role)).attach('video', bytes, '../../original.bin').attach('thumbnail', thumbnail, 'thumbnail.bin');
  };

  test('stages both files with a safe ID and submits metadata into storage, then cleans temporary files', async () => {
    expect((await upload()).status).toBe(201);
    expect(await readFile(join(temporaryDirectory, 'upload.video'))).toEqual(Buffer.from([0, 128, 255]));
    const result = await request(app.server)
      .post('/api/video/submit')
      .set(headers('editor'))
      .send({ ...video, videoId: 'upload' })
      .expect(201);
    expect(result.body).toMatchObject({ videoId: 'upload', description: video.description, recorded: video.recorded.toISOString() });
    expect(await db.findOneVideoByVideoId({ videoId: 'upload' })).toMatchObject({ videoId: 'upload' });
    expect(await readdir(temporaryDirectory)).toEqual([]);
    const downloaded = await request(app.server).get('/api/video/file/upload').set(headers()).expect(200);
    expect(downloaded.body).toEqual(Buffer.from([0, 128, 255]));
    const thumbnail = await request(app.server).get('/api/video/thumbnail/upload').set(headers()).expect(200);
    expect(thumbnail.body).toEqual(Buffer.from([42]));
    await request(app.server)
      .post('/api/video/submit')
      .set(headers('editor'))
      .send({ ...video, videoId: 'upload' })
      .expect(409);
  });

  test('a staged upload survives rebuilding the app and can be submitted by another editor', async () => {
    expect((await upload()).status).toBe(201);
    await app.close();
    app = createApp({ auth, users, videos, comments }, { instanceSalt: 'ab'.repeat(32), staticDirectory, temporaryDirectory });
    await app.ready();
    await request(app.server)
      .post('/api/video/submit')
      .set(headers('editor2'))
      .send({ ...video, videoId: 'upload' })
      .expect(201);
  });

  test('returns 404 when staged files are missing instead of calling the video submit operation', async () => {
    expect((await upload()).status).toBe(201);
    await rm(join(temporaryDirectory, 'upload.thumbnail'));
    const submit = jest.spyOn(videos, 'submitVideo');
    await request(app.server)
      .post('/api/video/submit')
      .set(headers('editor'))
      .send({ ...video, videoId: 'upload' })
      .expect(404);
    expect(submit).not.toHaveBeenCalled();
    expect(await readdir(temporaryDirectory)).toEqual(['upload.video']);
  });

  test('another editor cannot overwrite existing temporary files, but can submit them', async () => {
    expect((await upload()).status).toBe(201);
    expect((await upload('upload', 'editor2', Buffer.from('replacement'))).status).toBe(409);
    expect(await readFile(join(temporaryDirectory, 'upload.video'))).toEqual(Buffer.from([0, 128, 255]));
    expect((await readdir(temporaryDirectory)).sort()).toEqual(['upload.thumbnail', 'upload.video']);
    await request(app.server)
      .post('/api/video/submit')
      .set(headers('editor2'))
      .send({ ...video, videoId: 'upload' })
      .expect(201);
    expect(await readdir(temporaryDirectory)).toEqual([]);
  });

  test('rejects duplicate staged uploads without overwriting files', async () => {
    expect((await upload()).status).toBe(201);
    expect((await upload()).status).toBe(409);
    await request(app.server).post('/api/video/upload/..%2Fescape').set(headers('editor')).expect(400);
    expect(await readFile(join(temporaryDirectory, 'upload.video'))).toEqual(Buffer.from([0, 128, 255]));
  });

  const replacementUpload = async function (files: ('video' | 'thumbnail')[], videoId = 'v1') {
    let pending = request(app.server).post(`/api/video/upload/${videoId}`).set(headers('editor'));
    for (const file of files) pending = pending.attach(file, Buffer.from(`new-${file}`), `${file}.bin`);
    return pending;
  };

  test.each([
    { files: ['video'] as ('video' | 'thumbnail')[], changes: { videoMimeType: 'video/webm' } },
    { files: ['thumbnail'] as ('video' | 'thumbnail')[], changes: { thumbnailMimeType: 'image/webp' } },
    { files: ['video', 'thumbnail'] as ('video' | 'thumbnail')[], changes: { videoMimeType: 'video/webm', thumbnailMimeType: 'image/webp' } }
  ])('stages and submits a $files replacement while preserving unrelated metadata and files', async ({ files, changes }) => {
    expect((await replacementUpload(files)).status).toBe(201);
    expect(await videos.readVideoFileRange({ videoId: 'v1' })).toEqual(Buffer.from([0, 1, 128, 255]));
    expect(await videos.readThumbnailFile({ videoId: 'v1' })).toEqual(Buffer.from([0, 1, 128, 255]));
    await request(app.server)
      .patch('/api/video/change/files/v1')
      .set(headers('editor2'))
      .send({ ...change, ...changes })
      .expect(204);
    expect(await db.findOneVideoByVideoId({ videoId: 'v1' })).toEqual({ ...video, ...changes, lastModified: new Date(change.lastModified), hmac: change.hmac });
    const videoResponse = await request(app.server).get('/api/video/file/v1').set(headers()).expect(200);
    expect(videoResponse.body).toEqual(files.includes('video') ? Buffer.from('new-video') : Buffer.from([0, 1, 128, 255]));
    const thumbnailResponse = await request(app.server).get('/api/video/thumbnail/v1').set(headers()).expect(200);
    expect(thumbnailResponse.body).toEqual(files.includes('thumbnail') ? Buffer.from('new-thumbnail') : Buffer.from([0, 1, 128, 255]));
    expect(await readdir(temporaryDirectory)).toEqual([]);
  });

  test('submitting only the video leaves a staged thumbnail available for a later submit', async () => {
    expect((await replacementUpload(['video', 'thumbnail'])).status).toBe(201);
    await request(app.server)
      .patch('/api/video/change/files/v1')
      .set(headers('editor'))
      .send({ ...change, videoMimeType: 'video/webm' })
      .expect(204);
    expect(await readdir(temporaryDirectory)).toEqual(['v1.thumbnail']);
    expect((await db.findOneVideoByVideoId({ videoId: 'v1' }))?.thumbnailMimeType).toBe(video.thumbnailMimeType);
    await request(app.server)
      .patch('/api/video/change/files/v1')
      .set(headers('editor'))
      .send({ ...change, thumbnailMimeType: 'image/webp' })
      .expect(204);
    expect(await readdir(temporaryDirectory)).toEqual([]);
  });

  test('replacement requires the selected staged files and an existing video', async () => {
    const replace = jest.spyOn(videos, 'changeVideosFiles');
    expect((await replacementUpload(['thumbnail'])).status).toBe(201);
    await request(app.server)
      .patch('/api/video/change/files/v1')
      .set(headers('editor'))
      .send({ ...change, videoMimeType: 'video/webm' })
      .expect(404);
    await request(app.server)
      .patch('/api/video/change/files/missing')
      .set(headers('editor'))
      .send({ ...change, thumbnailMimeType: 'image/webp' })
      .expect(404);
    expect(replace).not.toHaveBeenCalled();
    expect(await readdir(temporaryDirectory)).toEqual(['v1.thumbnail']);
  });

  test.each([{ ...change }, { ...change, videoMimeType: '' }, { ...change, videoMimeType: null }, { ...change, videoMimeType: 'video/webm', meta: {} }])('rejects invalid replacement metadata %j', async (body) => {
    await request(app.server).patch('/api/video/change/files/v1').set(headers('editor')).send(body).expect(400);
  });

  test.each(['video-mimetype', 'thumbnail-mimetype'])('removes the old MIME-only route %s', async (path) => {
    await request(app.server)
      .patch(`/api/video/change/${path}/v1`)
      .set(headers('editor'))
      .send({ ...change, mimetype: 'unused/type' })
      .expect(404);
  });

  test('a failed second copy leaves the first replacement in storage and keeps temp files for retry', async () => {
    expect((await replacementUpload(['video', 'thumbnail'])).status).toBe(201);
    const save = jest.spyOn(StorageWrapper.prototype, 'saveThumbnailFile').mockRejectedValueOnce(new Error('Storage unavailable'));
    await request(app.server)
      .patch('/api/video/change/files/v1')
      .set(headers('editor'))
      .send({ ...change, videoMimeType: 'video/webm', thumbnailMimeType: 'image/webp' })
      .expect(500);
    expect(await videos.readVideoFileRange({ videoId: 'v1' })).toEqual(Buffer.from('new-video'));
    expect(await videos.readThumbnailFile({ videoId: 'v1' })).toEqual(Buffer.from([0, 1, 128, 255]));
    expect(await db.findOneVideoByVideoId({ videoId: 'v1' })).toEqual(video);
    expect((await readdir(temporaryDirectory)).sort()).toEqual(['v1.thumbnail', 'v1.video']);
    save.mockRestore();
    await request(app.server)
      .patch('/api/video/change/files/v1')
      .set(headers('editor'))
      .send({ ...change, videoMimeType: 'video/webm', thumbnailMimeType: 'image/webp' })
      .expect(204);
  });

  test('a replacement database failure preserves copied files and temporary files without rollback', async () => {
    expect((await replacementUpload(['video'])).status).toBe(201);
    jest.spyOn(db, 'changeVideosMimetypesByVideoId').mockRejectedValueOnce(new Error('Database unavailable'));
    await request(app.server)
      .patch('/api/video/change/files/v1')
      .set(headers('editor'))
      .send({ ...change, videoMimeType: 'video/webm' })
      .expect(500);
    expect(await videos.readVideoFileRange({ videoId: 'v1' })).toEqual(Buffer.from('new-video'));
    expect(await db.findOneVideoByVideoId({ videoId: 'v1' })).toEqual(video);
    expect(await readdir(temporaryDirectory)).toEqual(['v1.video']);
  });

  test.each(['video', 'thumbnail'] as const)('new videos still require both files when only %s is uploaded', async (file) => {
    expect((await replacementUpload([file], 'new-video')).status).toBe(400);
    expect(await readdir(temporaryDirectory)).toEqual([]);
  });

  test('failed submit preserves temporary files for retry, without leaving the busy marker behind', async () => {
    expect((await upload()).status).toBe(201);
    jest.spyOn(videos, 'submitVideo').mockRejectedValueOnce(new Error('Storage failed'));
    await request(app.server)
      .post('/api/video/submit')
      .set(headers('editor'))
      .send({ ...video, videoId: 'upload' })
      .expect(500);
    expect((await readdir(temporaryDirectory)).sort()).toEqual(['upload.thumbnail', 'upload.video']);
    await request(app.server)
      .post('/api/video/submit')
      .set(headers('editor'))
      .send({ ...video, videoId: 'upload' })
      .expect(201);
  });

  test('an existing busy file rejects submit without removing the other submit lock', async () => {
    expect((await upload()).status).toBe(201);
    await writeFile(join(temporaryDirectory, '.upload.busy'), 'existing-lock');
    const submit = jest.spyOn(videos, 'submitVideo');
    await request(app.server)
      .post('/api/video/submit')
      .set(headers('editor2'))
      .send({ ...video, videoId: 'upload' })
      .expect(409);
    expect(submit).not.toHaveBeenCalled();
    expect(await readFile(join(temporaryDirectory, '.upload.busy'), 'utf8')).toBe('existing-lock');
  });

  test('concurrent submissions execute the storage/database operation at most once', async () => {
    expect((await upload()).status).toBe(201);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((done) => {
      entered = done;
    });
    const wait = new Promise<void>((done) => {
      release = done;
    });
    const submit = jest.spyOn(videos, 'submitVideo').mockImplementation(async () => {
      entered();
      await wait;
    });
    const first = request(app.server)
      .post('/api/video/submit')
      .set(headers('editor'))
      .send({ ...video, videoId: 'upload' })
      .then((result) => result);
    await started;
    expect((await lstat(join(temporaryDirectory, '.upload.busy'))).isFile()).toBe(true);
    expect(await readFile(join(temporaryDirectory, '.upload.busy'), 'utf8')).toBe('');
    await request(app.server)
      .post('/api/video/submit')
      .set(headers('editor'))
      .send({ ...video, videoId: 'upload' })
      .expect(409);
    release();
    expect((await first).status).toBe(201);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(await readdir(temporaryDirectory)).not.toContain('.upload.busy');
  });

  test.each(['video', 'thumbnail'])('rejects an oversized %s and removes partial uploads', async (field) => {
    const result = await upload('large', 'editor', Buffer.alloc(field === 'video' ? 1025 : 3), Buffer.alloc(field === 'thumbnail' ? 17 : 1));
    expect(result.status).toBe(413);
    expect(await readdir(temporaryDirectory)).toEqual([]);
  });

  test('rejects missing, duplicate and unexpected upload fields and removes partial files', async () => {
    await request(app.server).post('/api/video/upload/missing').set(headers('editor')).attach('video', Buffer.from('x'), 'video').expect(400);
    await request(app.server).post('/api/video/upload/extra').set(headers('editor')).attach('unexpected', Buffer.from('x'), 'file').expect(400);
    await request(app.server).post('/api/video/upload/duplicate').set(headers('editor')).attach('video', Buffer.from('x'), 'one').attach('video', Buffer.from('y'), 'two').expect(400);
    expect(await readdir(temporaryDirectory)).toEqual([]);
  });

  test('does not remove an unrelated preexisting temporary file on a failed upload', async () => {
    await writeFile(join(temporaryDirectory, 'collision.video'), 'keep');
    expect((await upload('collision')).status).toBe(409);
    expect(await readFile(join(temporaryDirectory, 'collision.video'), 'utf8')).toBe('keep');
  });

  test('rejects malformed multipart input and removes partial files', async () => {
    await request(app.server).post('/api/video/upload/malformed').set(headers('editor')).set('Content-Type', 'multipart/form-data; boundary=broken').send('--broken\r\n').expect(400);
    expect(await readdir(temporaryDirectory)).toEqual([]);
  });

  test('deleting a video also deletes its comments and both stored files', async () => {
    await request(app.server).delete('/api/video/delete/v1').set(headers('editor')).expect(204);
    expect(await db.findOneCommentByCommentId({ commentId: 'c1' })).toBeNull();
    expect(await videos.readThumbnailFile({ videoId: 'v1' })).toBeNull();
    expect(await videos.readVideoFileRange({ videoId: 'v1' })).toBeNull();
  });

  test('returns 404 when metadata exists but the corresponding stored files are missing', async () => {
    await db.postVideo({ ...video, videoId: 'no-files' });
    await request(app.server).get('/api/video/file/no-files').set(headers()).expect(404);
    await request(app.server).get('/api/video/thumbnail/no-files').set(headers()).expect(404);
  });

  test('serves public static files without authentication and never exposes private directories', async () => {
    await request(app.server).get('/').expect(200, '<h1>VideoVault</h1>');
    await request(app.server).head('/index.html').expect(200);
    for (const path of ['/.secret', '/.salt', '/jwtkeys/key-0.key', '/tmp/upload.video', '/conf/db.json', '/missing']) await request(app.server).get(path).expect(404);
    await request(app.server).get('/api/missing').set(headers()).expect(404);
  });

  test('returns sanitized errors for malformed JSON, oversized requests, conflicts and server failures', async () => {
    await request(app.server).post('/login').set('Content-Type', 'application/json').send('{').expect(400, { error: 'Invalid request' });
    await request(app.server)
      .post('/login')
      .send({ username: 'x', loginHash: 'x'.repeat(1024 * 1024) })
      .expect(413);
    await request(app.server).patch('/api/user/change/username/target').set(headers()).send({ loginHash }).expect(409);
    jest.spyOn(users, 'findAllUsers').mockRejectedValueOnce(new Error(`secret ${storedHash}`));
    await request(app.server).get('/api/user/all').set(headers('admin')).expect(500, { error: 'Internal server error' });
    jest.spyOn(auth, 'authenticate').mockRejectedValueOnce(new Error('DB unavailable'));
    await request(app.server).get('/api/user/me').set(headers()).expect(500, { error: 'Internal server error' });
  });

  test.each([
    ['get', '/api/user/find/missing'],
    ['patch', '/api/user/change/displayname/missing/name'],
    ['delete', '/api/user/delete/missing'],
    ['get', '/api/video/find/missing'],
    ['delete', '/api/video/delete/missing'],
    ['get', '/api/video/file/missing'],
    ['get', '/api/comment/find/missing']
  ] as const)('%s %s returns 404 for missing resources', async (method, path) => {
    const all = makeUser('admin');
    await db.changeUsersEditorRoleByUserId({ userId: all.userId, editor: true });
    await request(app.server)[method](path).set(headers('admin')).expect(404);
  });
});
