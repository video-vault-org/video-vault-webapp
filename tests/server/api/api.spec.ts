import { unlink, readFile, mkdir, writeFile } from 'fs/promises';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { User } from '@/user/types/User';
import { deleteDirectory, exists } from '#/util';
import { initJwt, issueToken } from '@/auth/jwt';
import { buildApi } from '@/server/api';
import request from 'supertest';
import { AuthorizedUserRequest } from '@/server/types/AuthorizedUserRequest';
import { initialize } from '@/init';
import { AuthorizedInitRequest } from '@/server/types/AuthorizedInitRequest';

const mocked_db = new InMemoryDatabaseAdapter();

jest.mock('@/db', () => {
  const actual = jest.requireActual('@/db');
  // noinspection JSUnusedGlobalSymbols used as mock
  return {
    ...actual,
    async loadDb() {
      return mocked_db;
    }
  };
});

describe('api', () => {
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

  beforeEach(async () => {
    mocked_db.getMemory().user_ = { name: 'user_', key: '', fields: {}, items: [] };
    mocked_db.getMemory().jwtkey = { name: 'jwtkey', key: '', fields: {}, items: [] };
    mocked_db.getMemory().lock = { name: 'lock', key: '', fields: {}, items: [] };
  });

  afterEach(async () => {
    delete mocked_db.getMemory().user_;
    delete mocked_db.getMemory().jwtkey;
    delete mocked_db.getMemory().lock;
    if (await exists('./initKey')) {
      await unlink('./initKey');
    }
    await deleteDirectory('./web');
    await deleteDirectory('./conf');
  });

  describe('authorize', () => {
    test('ignores /api/user/login.', async () => {
      const api = buildApi(false);

      const response = await request(api).post('/api/user/login').send({ username: 'a', password: 'b' });

      expect(response.status).toBe(401);
      expect(response.body.error).toEqual('invalid-login');
    });

    test('authorizes user.', async () => {
      mocked_db.getMemory().user_.items.push({ ...testUser });
      await initJwt();
      const token = issueToken(testUser.userId);
      const api = buildApi(false);
      api.post('/api/test', (req, res) => {
        res.status(200).json({ authorizedUser: (req as AuthorizedUserRequest).authorizedUser });
      });

      const response = await request(api)
        .post('/api/test')
        .set('authorize', 'Bearer ' + token);

      expect(response.status).toBe(200);
      expect(response.body.authorizedUser).toEqual(testUser);
    });

    test('authorizes init.', async () => {
      mocked_db.getMemory().user_.items.push({ ...testUser });
      await initialize();
      await initJwt();
      const api = buildApi(false);
      const token = (await readFile('./initKey')).toString('utf8');
      api.post('/api/test', (req, res) => {
        res.status(200).json({ authorizedInit: (req as AuthorizedInitRequest).authorizedInit });
      });

      const response = await request(api)
        .post('/api/test')
        .set('authorize', 'Bearer ' + token);

      expect(response.status).toBe(200);
      expect(response.body.authorizedInit).toBe(true);
    });

    test('responses unauthorized error if no token.', async () => {
      mocked_db.getMemory().user_.items.push({ ...testUser });
      await initJwt();
      const api = buildApi(false);
      api.post('/api/test', (req, res) => {
        res.status(200).json({ authorizedUser: (req as AuthorizedUserRequest).authorizedUser });
      });

      const response = await request(api).post('/api/test');

      expect(response.status).toBe(401);
      expect(response.body.error).toEqual('unauthorized');
    });
  });

  describe('json', () => {
    test('parses json.', async () => {
      mocked_db.getMemory().user_.items.push({ ...testUser });
      await initJwt();
      const token = issueToken(testUser.userId);
      const api = buildApi(false);
      api.post('/test', (req, res) => {
        const test = req.body.test;
        res.status(200).json({ test });
      });

      const response = await request(api)
        .post('/test')
        .send({ test: 'test' })
        .set('authorize', 'Bearer ' + token);

      expect(response.status).toBe(200);
      expect(response.body.test).toEqual('test');
    });
  });

  describe('init', () => {
    test('responses true, if no configs given.', async () => {
      const api = buildApi(false);

      const response = await request(api).get('/init');

      expect(response.status).toBe(200);
      expect(response.body.init).toBe(true);
    });

    test('responses false, if all configs given.', async () => {
      const api = buildApi(false);
      await mkdir('./conf', { recursive: true });
      await writeFile('./conf/storage.json', Buffer.from(JSON.stringify({ type: 'local', conf: { basePath: './' } }), 'utf8'));
      await writeFile('./conf/db.json', Buffer.from(JSON.stringify({ type: 'in-memory' }), 'utf8'));
      await writeFile('./conf/frontend.json', Buffer.from(JSON.stringify({ title: '', logo: '', videoMeta: [] }), 'utf8'));

      const response = await request(api).get('/init');

      expect(response.status).toBe(200);
      expect(response.body.init).toBe(false);
    });
  });

  describe('sub apis', () => {
    test('userApi is attached correctly.', async () => {
      mocked_db.getMemory().user_.items.push({ ...testUser, userManager: false });
      mocked_db.getMemory().user_.items.push({ ...testUser, userId: 'manager', userManager: true });
      await initJwt();
      const tokenNormal = issueToken(testUser.userId);
      const tokenManager = issueToken('manager');
      const api = buildApi(false);
      api.post('/api/user/manage/test', (_, res) => {
        res.status(200).send({ ok: 'ok' });
      });

      const responseNormal = await request(api)
        .post('/api/user/manage/test')
        .set('authorize', 'Bearer ' + tokenNormal);
      const responseManager = await request(api)
        .post('/api/user/manage/test')
        .set('authorize', 'Bearer ' + tokenManager);

      expect(responseNormal.status).toBe(403);
      expect(responseNormal.body.error).toEqual('forbidden');
      expect(responseManager.status).toBe(200);
      expect(responseManager.body.ok).toEqual('ok');
    });

    test('commentApi is attached correctly.', async () => {
      mocked_db.getMemory().user_.items.push({ ...testUser, videoManager: false });
      mocked_db.getMemory().user_.items.push({ ...testUser, userId: 'manager', videoManager: true });
      await initJwt();
      const tokenNormal = issueToken(testUser.userId);
      const tokenManager = issueToken('manager');
      const api = buildApi(false);
      api.post('/api/comment/manage/test', (_, res) => {
        res.status(200).send({ ok: 'ok' });
      });

      const responseNormal = await request(api)
        .post('/api/comment/manage/test')
        .set('authorize', 'Bearer ' + tokenNormal);
      const responseManager = await request(api)
        .post('/api/comment/manage/test')
        .set('authorize', 'Bearer ' + tokenManager);

      expect(responseNormal.status).toBe(403);
      expect(responseNormal.body.error).toEqual('forbidden');
      expect(responseManager.status).toBe(200);
      expect(responseManager.body.ok).toEqual('ok');
    });

    test('videoApi is attached correctly.', async () => {
      mocked_db.getMemory().user_.items.push({ ...testUser, videoManager: false });
      mocked_db.getMemory().user_.items.push({ ...testUser, userId: 'manager', videoManager: true });
      await initJwt();
      const tokenNormal = issueToken(testUser.userId);
      const tokenManager = issueToken('manager');
      const api = buildApi(false);
      api.post('/api/video/manage/test', (_, res) => {
        res.status(200).send({ ok: 'ok' });
      });

      const responseNormal = await request(api)
        .post('/api/video/manage/test')
        .set('authorize', 'Bearer ' + tokenNormal);
      const responseManager = await request(api)
        .post('/api/video/manage/test')
        .set('authorize', 'Bearer ' + tokenManager);

      expect(responseNormal.status).toBe(403);
      expect(responseNormal.body.error).toEqual('forbidden');
      expect(responseManager.status).toBe(200);
      expect(responseManager.body.ok).toEqual('ok');
    });

    test('configApi is attached correctly.', async () => {
      mocked_db.getMemory().user_.items.push({ ...testUser, admin: false });
      mocked_db.getMemory().user_.items.push({ ...testUser, userId: 'manager', admin: true });
      await initJwt();
      const tokenNormal = issueToken(testUser.userId);
      const tokenManager = issueToken('manager');
      const api = buildApi(false);
      api.post('/api/config/manage/test', (_, res) => {
        res.status(200).send({ ok: 'ok' });
      });

      const responseNormal = await request(api)
        .post('/api/config/manage/test')
        .set('authorize', 'Bearer ' + tokenNormal);
      const responseManager = await request(api)
        .post('/api/config/manage/test')
        .set('authorize', 'Bearer ' + tokenManager);

      expect(responseNormal.status).toBe(403);
      expect(responseNormal.body.error).toEqual('forbidden');
      expect(responseManager.status).toBe(200);
      expect(responseManager.body.ok).toEqual('ok');
    });
  });

  describe('web', () => {
    test('serves given web file.', async () => {
      const css = 'body { margin: 0 }';
      await mkdir('./web', { recursive: true });
      await writeFile('./web/test.css', Buffer.from(css, 'utf8'));
      const api = buildApi(true);

      const response = await request(api).get('/test.css');

      expect(response.status).toBe(200);
      expect(response.text).toEqual(css);
      expect(response.headers['content-type']).toEqual('text/css; charset=utf-8');
      expect(response.headers['content-length']).toBe(css.length + '');
    });
  });

  describe('fallbacks', () => {
    test('falls back to 404 fallback.', async () => {
      const api = buildApi(true);

      const response = await request(api).get('/test.css');

      expect(response.status).toBe(404);
      expect(response.body.error).toEqual('Cannot GET /test.css');
    });

    test('falls back to error fallback.', async () => {
      const api = buildApi(true);
      await initJwt();
      const token = issueToken(testUser.userId);
      delete mocked_db.getMemory().user_;

      const response = await request(api)
        .post('/api/user/manage/add')
        .set('authorize', 'Bearer ' + token);

      expect(response.status).toBe(500);
      expect(response.body.error).toEqual("Cannot read properties of undefined (reading 'items')");
    });
  });
});
