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

  function application(salt: string) {
    const db = new InMemoryDatabaseAdapter();
    const auth = new AuthService(db);
    const authenticate = jest.spyOn(auth, 'authenticate');
    const server = createApp({ auth, users: new UserService(db), videos: new VideoService(new StorageWrapper(new InMemoryStorageAdapter()), db), comments: new CommentService(db) }, { instanceSalt: salt, logger: false });
    return { server, authenticate };
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
    jest.restoreAllMocks();
  });

  test('returns only the protocol version and public instance salt without authentication', async () => {
    const { server, authenticate } = application(instanceSalt);
    app = server;

    const response = await app.inject('/bootstrap');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ version: 1, instanceSalt });
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
      expect(response.json()).toEqual({ version: 1, instanceSalt });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(authenticate).not.toHaveBeenCalled();
  });

  test.each(['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 'a'.repeat(64) + '\n'])('rejects invalid instance salt configuration before creating the server (%j)', (salt) => {
    expect(() => application(salt)).toThrow('Instance salt must contain exactly 64 hexadecimal characters');
  });
});
