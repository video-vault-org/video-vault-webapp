import { unlink, readFile, mkdir, writeFile } from 'fs/promises';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { deleteDirectory, exists } from '#/util';
import { initJwt, issueToken } from '@/auth/jwt';
import { buildApi } from '@/server/api';
import request from 'supertest';
import { initialize } from '@/init';
import { setPort } from '@/server/handler/indexHandler';
import { User } from '@/user/types/User';
import { AuthorizedUserRequest } from '@/server/types/AuthorizedUserRequest';
import { AuthorizedInitRequest } from '@/server/types/AuthorizedInitRequest';
import { Lock } from '@/auth/types/Lock';
import { DbItem } from '@/db/types/DbItem';
import { FrontendConfig } from '@/frontend/types/FrontendConfig';

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

jest.mock('@/logging/Logger', () => {
  return {
    Logger: class Logger {
      // noinspection JSUnusedGlobalSymbols
      public info(): Logger {
        return this;
      }
      // noinspection JSUnusedGlobalSymbols
      public access(): Logger {
        return this;
      }
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
    await deleteDirectory('./frontend/dist');
    await deleteDirectory('./conf');
  });

  describe('authorize', () => {
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

  describe('loginHandler', () => {
    // noinspection SpellCheckingInspection
    const hash = 'hvMAotfYqXiBQjYItFh2JY5kUIL8zWXZGSJPF6goIi0=';

    test('logs user in.', async () => {
      const api = buildApi(true);
      mocked_db.getMemory().user_.items.push({ ...testUser, hash, salt: '01'.repeat(16), hashAlgorithm: 'scrypt' });

      const response = await request(api).post('/login').send({ username: testUser.username, password: 'abc' });

      expect(response.status).toBe(200);
      expect(response.body.token).toContain('ey');
      expect(response.body.token).toContain('.');
      expect(response.body.expires).toBeGreaterThan(0);
      expect(response.body.userKey).toEqual('testKey');
    });

    test('responses error if invalid username', async () => {
      const api = buildApi(true);
      mocked_db.getMemory().user_.items.push({ ...testUser, hash, salt: '01'.repeat(16), hashAlgorithm: 'scrypt' });

      const response = await request(api).post('/login').send({ username: '-', password: 'abc' });

      expect(response.status).toBe(401);
      expect(response.body.error).toEqual('invalid-login');
    });

    test('responses error if invalid password', async () => {
      const api = buildApi(true);
      mocked_db.getMemory().user_.items.push({ ...testUser, hash, salt: '01'.repeat(16), hashAlgorithm: 'scrypt' });

      const response = await request(api).post('/login').send({ username: testUser.username, password: 'xyz' });

      expect(response.status).toBe(401);
      expect(response.body.error).toEqual('invalid-login');
    });

    test('responses error if login for username is locked', async () => {
      const api = buildApi(true);
      const lock: Lock = { username: testUser.username, attempts: 6, lastAttempt: new Date() };
      mocked_db.getMemory().user_.items.push({ ...testUser, hash, salt: '01'.repeat(16), hashAlgorithm: 'scrypt' });
      mocked_db.getMemory().lock.items.push(lock as unknown as DbItem);

      const response = await request(api).post('/login').send({ username: testUser.username, password: 'abc' });

      expect(response.status).toBe(401);
      expect(response.body.error).toEqual('invalid-login');
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

  describe('frontend', () => {
    test('serves given static file on /test.css.', async () => {
      const css = 'body { margin: 0 }';
      await mkdir('./frontend/dist', { recursive: true });
      await writeFile('./frontend/dist/test.css', Buffer.from(css, 'utf8'));
      const api = buildApi(true);

      const response = await request(api).get('/test.css');

      expect(response.status).toBe(200);
      expect(response.text).toEqual(css);
      expect(response.headers['content-type']).toEqual('text/css; charset=utf-8');
      expect(response.headers['content-length']).toBe(css.length + '');
    });

    test('serves generated index.html on /.', async () => {
      const config: FrontendConfig = { logo: 'testLogo', title: 'testTitle', description: 'testDesc', videoMeta: [] };
      await deleteDirectory('./frontend/dist/assets');
      await mkdir('./conf', { recursive: true });
      await mkdir('./frontend/dist/assets', { recursive: true });
      await writeFile('./conf/frontend.json', Buffer.from(JSON.stringify(config), 'utf8'));
      await writeFile('./frontend/dist/assets/index-12345abc.js', Buffer.from('const t = 2;', 'utf8'));
      await writeFile('./frontend/dist/assets/index-cba54321.css', Buffer.from('body { margin: 0 }', 'utf8'));
      const api = buildApi(true);
      setPort('1234');

      const response = await request(api).get('/');

      expect(response.status).toBe(200);
      expect(response.text).toContain('/logo/testLogo/favicon.ico');
      expect(response.text).toContain('property="og:title" content="testTitle"');
      expect(response.text).toContain('property="og:description" content="testDesc"');
      expect(response.text).toContain('property="og:image" content="http://127.0.0.1:1234/logo/testLogo/og-image.jpg"');
      expect(response.text).toContain('script type="module" crossorigin src="/assets/index-12345abc.js"');
      expect(response.text).toContain('link rel="stylesheet" crossorigin href="/assets/index-cba54321.css"');
      expect(response.text).not.toContain('script type="module" src="/src/main.tsx"');
      expect(response.headers['content-type']).toEqual('text/html; charset=utf-8');
      expect(response.headers['content-length']).toBe(response.text.length + '');
    });

    test('redirects direct index.html request on /index.html', async () => {
      const api = buildApi(true);

      const response = await request(api).get('/index.html');

      expect(response.status).toBe(301);
      expect(response.headers['location']).toEqual('/');
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
