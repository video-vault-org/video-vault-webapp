import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FastifyInstance } from 'fastify';
import { createApp } from '@/http/app';
import { UploadStore, UPLOAD_PART_BYTES } from '@/http/uploads';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';
import { StorageWrapper } from '@/storage/StorageWrapper';
import { VideoService } from '@/service/VideoService';
import { UserService } from '@/service/UserService';
import { CommentService } from '@/service/CommentService';
import { AuthService } from '@/service/AuthService';

const video = { deleted: false, videoId: 'v1', title: 'encrypted', description: 'encrypted', meta: {}, recorded: new Date(0), lastModified: new Date(1), hmac: 'hmac', videoMimeType: 'video/mp4', thumbnailMimeType: 'image/png' };
const headers = { authorization: 'Bearer editor' };

describe('bounded encrypted packet uploads', () => {
  let app: FastifyInstance, directory: string, db: InMemoryDatabaseAdapter, storage: InMemoryStorageAdapter;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vault-packets-'));
    await writeFile(join(directory, 'index.html'), '<title>VideoVault</title>');
    db = new InMemoryDatabaseAdapter();
    storage = new InMemoryStorageAdapter();
    await db.postVideo(video);
    const auth = {
      authenticate: jest.fn(async ({ token }: { token: string }) => (['editor', 'reader'].includes(token) ? { userId: token, editor: token === 'editor' } : null)),
      authorize: jest.fn((user: { editor: boolean }) => (user.editor ? ['editor'] : []))
    } as unknown as AuthService;
    app = createApp(
      { auth, users: new UserService(db), videos: new VideoService(new StorageWrapper(storage, { temporaryDirectory: directory }), db), comments: new CommentService(db) },
      { instanceSalt: 'ab'.repeat(32), staticDirectory: directory, temporaryDirectory: directory, maxVideoBytes: 1024, maxThumbnailBytes: 16, logger: false }
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  const start = async function (videoId = 'v1', files = [{ kind: 'video', size: 5 }]) {
    const response = await app.inject({ method: 'POST', url: `/api/video/upload/${videoId}/start`, headers, payload: { files } });
    expect(response.statusCode).toBe(201);
    expect(response.json().maxPartBytes).toBe(UPLOAD_PART_BYTES);
    return `/api/video/upload/${videoId}/${response.json().uploadId}`;
  };

  const part = (session: string, kind: string, offset: number, data: number[]) =>
    app.inject({ method: 'PUT', url: `${session}/${kind}?offset=${offset}`, headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: Buffer.from(data) });

  test('acknowledges written bytes, accepts matching retries and never publishes incomplete files', async () => {
    const session = await start();
    expect((await part(session, 'video', 0, [1, 2])).json()).toEqual({ received: 2 });
    expect((await part(session, 'video', 0, [1, 2])).json()).toEqual({ received: 2 });
    expect((await part(session, 'video', 4, [5])).statusCode).toBe(409);
    expect((await part(session, 'video', 0, [9, 2])).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `${session}/complete`, headers })).statusCode).toBe(409);
    await expect(readFile(join(directory, 'v1.video'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await part(session, 'video', 2, [3, 4, 5])).json()).toEqual({ received: 5 });
    for (let i = 0; i < 2; i++) expect((await app.inject({ method: 'POST', url: `${session}/complete`, headers })).statusCode).toBe(204);
    expect(await readFile(join(directory, 'v1.video'))).toEqual(Buffer.from([1, 2, 3, 4, 5]));
    expect((await part(session, 'video', 0, [1])).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: session, headers })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: session, headers })).statusCode).toBe(204);
    expect(await readFile(join(directory, 'v1.video'))).toHaveLength(5);
    expect((await readdir(directory)).filter((name) => name.startsWith('.upload-'))).toEqual([]);
  });

  test('stages both files for a new video and uses the existing metadata submit', async () => {
    const session = await start('new-video', [
      { kind: 'video', size: 3 },
      { kind: 'thumbnail', size: 2 }
    ]);
    expect((await part(session, 'video', 0, [1, 2, 3])).statusCode).toBe(200);
    expect((await part(session, 'thumbnail', 0, [4, 5])).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `${session}/complete`, headers })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: session, headers })).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: '/api/video/submit', headers, payload: { ...video, videoId: 'new-video' } })).statusCode).toBe(201);
    expect(await storage.read('new-video.video')).toEqual(Buffer.from([1, 2, 3]));
    expect(await storage.read('new-video.thumbnail')).toEqual(Buffer.from([4, 5]));
  });

  test.each([['video'], ['thumbnail'], ['video', 'thumbnail']])('supports a %j replacement without changing unrelated attributes', async (...kinds) => {
    const files = kinds.map((kind) => ({ kind, size: 2 }));
    const session = await start('v1', files);
    for (const kind of kinds) expect((await part(session, kind, 0, [8, 9])).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `${session}/complete`, headers })).statusCode).toBe(204);
    await app.inject({ method: 'DELETE', url: session, headers });
    const payload = { lastModified: new Date(2).toISOString(), hmac: 'updated', ...Object.fromEntries(kinds.map((kind) => [`${kind}MimeType`, kind === 'video' ? 'video/webm' : 'image/webp'])) };
    expect((await app.inject({ method: 'PATCH', url: '/api/video/change/files/v1', headers, payload })).statusCode).toBe(204);
    expect(await db.findOneVideoByVideoId({ videoId: 'v1' })).toMatchObject({ title: video.title, description: video.description, meta: video.meta, hmac: 'updated' });
    for (const kind of kinds) expect(await storage.read(`v1.${kind}`)).toEqual(Buffer.from([8, 9]));
  });

  test('preflights limits, required files and duplicate kinds without creating partial data', async () => {
    for (const [videoId, files, status] of [
      ['v1', [{ kind: 'video', size: 1025 }], 413],
      ['v1', [{ kind: 'thumbnail', size: 17 }], 413],
      ['new-video', [{ kind: 'video', size: 5 }], 400],
      [
        'v1',
        [
          { kind: 'video', size: 5 },
          { kind: 'video', size: 5 }
        ],
        400
      ]
    ] as const) {
      expect((await app.inject({ method: 'POST', url: `/api/video/upload/${videoId}/start`, headers, payload: { files } })).statusCode).toBe(status);
    }
    expect(await readdir(directory)).toEqual(['index.html']);
  });

  test('binds sessions to video IDs, enforces sizes and cleans up aborted uploads', async () => {
    const session = await start();
    expect((await part(session.replace('/v1/', '/other/'), 'video', 0, [1])).statusCode).toBe(404);
    expect((await part(session, 'thumbnail', 0, [1])).statusCode).toBe(409);
    expect((await part(session, 'video', 0, [1, 2, 3, 4, 5, 6])).statusCode).toBe(413);
    expect((await app.inject({ method: 'PUT', url: `${session}/video?offset=0`, headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(UPLOAD_PART_BYTES + 1) })).statusCode).toBe(413);
    expect((await part(session, 'video', 0, [1, 2])).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: session, headers })).statusCode).toBe(204);
    expect(await readdir(directory)).toEqual(['index.html']);
  });

  test('does not overwrite existing staged files when another session completes first', async () => {
    const first = await start(),
      second = await start();
    await part(first, 'video', 0, [1, 2, 3, 4, 5]);
    await part(second, 'video', 0, [5, 4, 3, 2, 1]);
    expect((await app.inject({ method: 'POST', url: `${first}/complete`, headers })).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: `${second}/complete`, headers })).statusCode).toBe(409);
    expect(await readFile(join(directory, 'v1.video'))).toEqual(Buffer.from([1, 2, 3, 4, 5]));
  });

  test('rolls back its published first file when publishing the second file conflicts', async () => {
    const session = await start('new-video', [
      { kind: 'video', size: 2 },
      { kind: 'thumbnail', size: 2 }
    ]);
    await part(session, 'video', 0, [1, 2]);
    await part(session, 'thumbnail', 0, [3, 4]);
    await writeFile(join(directory, 'new-video.thumbnail'), 'other upload');
    expect((await app.inject({ method: 'POST', url: `${session}/complete`, headers })).statusCode).toBe(409);
    await expect(readFile(join(directory, 'new-video.video'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(directory, 'new-video.thumbnail'), 'utf8')).toBe('other upload');
  });

  test('requires editor privileges for all session operations and rejects tombstoned video IDs', async () => {
    const session = await start();
    for (const authorization of [undefined, 'Bearer reader']) {
      const denied = authorization ? { authorization } : {};
      for (const [method, url] of [
        ['POST', '/api/video/upload/v1/start'],
        ['PUT', `${session}/video?offset=0`],
        ['POST', `${session}/complete`],
        ['DELETE', session]
      ] as const) {
        expect((await app.inject({ method, url, headers: denied })).statusCode).toBe(authorization ? 403 : 401);
      }
    }
    await db.deleteVideoByVideoId({ videoId: 'v1', lastModified: new Date(2) });
    expect((await app.inject({ method: 'POST', url: '/api/video/upload/v1/start', headers, payload: { files: [{ kind: 'video', size: 5 }] } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `${session}/complete`, headers })).statusCode).toBe(409);
  });

  test('serializes competing writes to the same session and remains usable after recreating the store', async () => {
    const uploads = new UploadStore({ directory });
    const id = await uploads.start('v1', [{ kind: 'video', size: 3 }], { allowPartial: true });
    const outcomes = await Promise.allSettled([uploads.append('v1', id, 'video', 0, Buffer.from([1, 2, 3])), uploads.append('v1', id, 'video', 0, Buffer.from([9, 9, 9]))]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    await new UploadStore({ directory }).complete('v1', id);
    expect(await readFile(join(directory, 'v1.video'))).toHaveLength(3);
  });
});
