import { DEFAULT_META_CONFIG, MetaConfig } from '@/meta/config/MetaConfig';
import { FastifyInstance } from 'fastify';
import { createApp } from '@/http/app';
import { AuthService } from '@/service/AuthService';
import { UserService } from '@/service/UserService';
import { VideoService } from '@/service/VideoService';
import { CommentService } from '@/service/CommentService';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';
import { StorageWrapper } from '@/storage/StorageWrapper';

describe('public bootstrap', () => {
  const instanceSalt = 'AB'.repeat(32);
  let app: FastifyInstance | undefined;

  const application = function (salt: string, title = 'VideoVault', metaConfig: MetaConfig = DEFAULT_META_CONFIG) {
    const db = new InMemoryDatabaseAdapter();
    const auth = new AuthService(db);
    const authenticate = jest.spyOn(auth, 'authenticate');
    const server = createApp(
      { auth, users: new UserService(db), videos: new VideoService(new StorageWrapper(new InMemoryStorageAdapter()), db), comments: new CommentService(db) },
      { instanceSalt: salt, appConfig: { title }, metaConfig, logger: false }
    );
    return { server, authenticate };
  };

  afterEach(async () => {
    await app?.close();
    app = undefined;
    jest.restoreAllMocks();
  });

  test('returns the protocol version, application title and public instance salt without authentication', async () => {
    const { server, authenticate } = application(instanceSalt);
    app = server;

    const response = await app.inject('/bootstrap');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ version: 1, instanceSalt, app: { title: 'VideoVault' }, meta: DEFAULT_META_CONFIG });
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(authenticate).not.toHaveBeenCalled();
  });

  test('repeated requests preserve the exact salt text and do not require a usable token', async () => {
    const { server, authenticate } = application(instanceSalt);
    app = server;

    for (let i = 0; i < 3; i++) {
      const response = await app.inject({ url: '/bootstrap', headers: { authorization: 'Bearer invalid' } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ version: 1, instanceSalt, app: { title: 'VideoVault' }, meta: DEFAULT_META_CONFIG });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(authenticate).not.toHaveBeenCalled();
  });

  test('returns a configured Unicode title as public JSON and uses it in the API documentation', async () => {
    const title = 'Familienvideos 🎬';
    const { server } = application(instanceSalt, title);
    app = server;
    const response = await app.inject('/bootstrap');
    expect(response.json()).toEqual({ version: 1, instanceSalt, app: { title }, meta: DEFAULT_META_CONFIG });
    const document = (await app.inject('/docs/json')).json();
    expect(document.info.title).toBe(`${title} API`);
  });

  test('publishes configured frontend fields and sorting order without authentication', async () => {
    const meta: MetaConfig = {
      recorded: { withTime: true, useAsFilter: false },
      fields: [{ key: 'actors', name: { de: 'Darsteller', en: 'Actors' }, type: 'text', multiple: true, required: false, showInDetails: true, useAsFilter: true }],
      sorting: [
        { source: 'title', direction: 'asc' },
        { source: 'meta', key: 'actors', direction: 'desc' }
      ]
    };
    const { server, authenticate } = application(instanceSalt, 'VideoVault', meta);
    app = server;
    for (let index = 0; index < 2; index++) {
      const response = await app.inject('/bootstrap');
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({ version: 1, instanceSalt, app: { title: 'VideoVault' }, meta });
    }
    expect(authenticate).not.toHaveBeenCalled();
  });

  test('rejects inconsistent metadata configuration before registering routes', () => {
    expect(() => application(instanceSalt, 'VideoVault', { ...DEFAULT_META_CONFIG, sorting: [{ source: 'meta', key: 'missing', direction: 'asc' }] })).toThrow('Unknown metadata sort key');
  });

  test.each(['', ' ', 'a'.repeat(101)])('rejects an invalid application title (%j)', (title) => {
    expect(() => application(instanceSalt, title)).toThrow();
  });

  test.each(['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 'a'.repeat(64) + '\n'])('rejects invalid instance salt configuration before creating the server (%j)', (salt) => {
    expect(() => application(salt)).toThrow('Instance salt must contain exactly 64 hexadecimal characters');
  });
});
