import request from 'supertest';
import express from 'express';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { initJwt } from '@/auth/jwt';
import { buildUserApi } from '@/server/userApi';
import { Lock } from '@/auth/types/Lock';
import { DbItem } from '@/db/types/DbItem';

const mocked_db = new InMemoryDatabaseAdapter();

jest.mock('@/db', () => {
  // noinspection JSUnusedGlobalSymbols used as mock
  return {
    async loadDb() {
      return mocked_db;
    }
  };
});

jest.mock('@/init', () => {
  const actual = jest.requireActual('@/init');
  // noinspection JSUnusedGlobalSymbols used as mock
  return {
    ...actual,
    async authorizeInit(token: string) {
      return token === 'abc';
    }
  };
});

jest.mock('@/auth', () => {
  const actual = jest.requireActual('@/auth');
  // noinspection JSUnusedGlobalSymbols used as mock
  return {
    ...actual,
    async hashPassword(password: string) {
      return ['salt', 'hash-of-' + password, 'algorithm'];
    }
  };
});

describe('api - user', () => {
  const testUser = {
    userId: 'testId',
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

  const buildApi = function () {
    const userApi = buildUserApi();
    const api = express();
    api.use(express.json());
    api.use('/user', userApi);
    return api;
  };

  beforeEach(async () => {
    mocked_db.getMemory().user_ = { name: 'user_', key: '', fields: {}, items: [] };
    mocked_db.getMemory().jwtkey = { name: 'jwtkey', key: '', fields: {}, items: [] };
    mocked_db.getMemory().lock = { name: 'lock', key: '', fields: {}, items: [] };
    await initJwt();
  });

  afterEach(() => {
    delete mocked_db.getMemory().user_;
    delete mocked_db.getMemory().jwtkey;
  });

  describe('userManagerHandler', () => {
    test('calls next if user is user manager.', async () => {
      const api = buildApi();
      api.post('/user/manage/test', (_, res) => {
        res.status(200).json({ message: 'ok' });
      });

      const response = await request(api)
        .post('/user/manage/test')
        .send({ authorizedUser: { ...testUser, userManager: true } });

      expect(response.status).toBe(200);
      expect(response.body?.message).toEqual('ok');
    });

    test('calls next if user is not user manager.', async () => {
      const api = buildApi();
      api.post('/user/manage/test', (_, res) => {
        res.status(200).json({ message: 'ok' });
      });

      const response = await request(api)
        .post('/user/manage/test')
        .send({ authorizedUser: { ...testUser, userManager: false } });

      expect(response.status).toBe(403);
      expect(response.body?.error).toEqual('forbidden');
    });
  });

  describe('addUserHandler', () => {
    test('adds user.', async () => {
      const api = buildApi();

      const response = await request(api)
        .post('/user/manage/add')
        .send({ authorizedUser: { ...testUser, userManager: true }, user: { ...testUser, userId: 'newId' }, password: 'pwd' });

      expect(response.status).toBe(201);
      expect(response.body.message).toEqual('created');
      expect(mocked_db.getMemory().user_.items[0]).toEqual({
        ...testUser,
        userId: 'newId',
        hash: 'hash-of-pwd',
        hashSalt: 'salt',
        hashAlgorithm: 'algorithm'
      });
    });

    test('responses error if user already exists by userId.', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api)
        .post('/user/manage/add')
        .send({ authorizedUser: { ...testUser, userManager: true }, user: { ...testUser }, password: 'pwd' });

      expect(response.status).toBe(500);
      expect(response.text).toContain('User already exists with id testId');
      expect(mocked_db.getMemory().user_.items.length).toBe(1);
    });

    test('responses error if user already exists by username.', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api)
        .post('/user/manage/add')
        .send({ authorizedUser: { ...testUser, userManager: true }, user: { ...testUser, userId: 'newId' }, password: 'pwd' });

      expect(response.status).toBe(500);
      expect(response.text).toContain('User already exists with username testName');
      expect(mocked_db.getMemory().user_.items.length).toBe(1);
    });
  });

  describe('modifyUsernameHandler', () => {
    test('modifies username.', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser });
      mocked_db.getMemory().user_.items.push({ ...testUser, userId: 'otherId', username: 'otherUsername' });

      const response = await request(api)
        .post('/user/manage/modify-username')
        .send({ authorizedUser: { ...testUser, userManager: true }, userId: 'otherId', username: 'newUsername' });

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('updated');
      expect(mocked_db.getMemory().user_.items[1]).toEqual({ ...testUser, userId: 'otherId', username: 'newUsername' });
    });

    test('responses error if user does not exist.', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api)
        .post('/user/manage/modify-username')
        .send({ authorizedUser: { ...testUser, userManager: true }, userId: 'otherId', username: 'newUsername' });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('not-updated');
    });
  });

  describe('modifyOwnUsernameHandler', () => {
    test('modifies username.', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api)
        .post('/user/modify-username')
        .send({ authorizedUser: { ...testUser, userManager: true }, username: 'newUsername' });

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('updated');
      expect(mocked_db.getMemory().user_.items[0]).toEqual({ ...testUser, username: 'newUsername' });
    });
  });

  describe('modifyCredentialsHandler', () => {
    test('modifies credentials.', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser });
      mocked_db.getMemory().user_.items.push({ ...testUser, userId: 'otherId', username: 'otherUsername' });

      const response = await request(api)
        .post('/user/manage/modify-credentials')
        .send({
          authorizedUser: { ...testUser, userManager: true },
          userId: 'otherId',
          username: 'un',
          password: 'pwd',
          passwordKeySalt: 'keySalt',
          userKey: 'key'
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('updated');
      expect(mocked_db.getMemory().user_.items[1]).toEqual({
        ...testUser,
        userId: 'otherId',
        username: 'un',
        hash: 'hash-of-pwd',
        hashSalt: 'salt',
        hashAlgorithm: 'algorithm',
        passwordKeySalt: 'keySalt',
        userKey: 'key'
      });
    });

    test('responses error if user does not exist.', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api)
        .post('/user/manage/modify-credentials')
        .send({
          authorizedUser: { ...testUser, userManager: true },
          userId: 'nope',
          username: 'un',
          password: 'pwd',
          passwordKeySalt: 'keySalt',
          userKey: 'key'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('not-updated');
    });
  });

  describe('modifyOwnCredentialsHandler', () => {
    test('modifies credentials.', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api)
        .post('/user/modify-credentials')
        .send({
          authorizedUser: { ...testUser, userManager: true },
          username: 'un',
          password: 'pwd',
          passwordKeySalt: 'keySalt',
          userKey: 'key'
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('updated');
      expect(mocked_db.getMemory().user_.items[0]).toEqual({
        ...testUser,
        username: 'un',
        hash: 'hash-of-pwd',
        hashSalt: 'salt',
        hashAlgorithm: 'algorithm',
        passwordKeySalt: 'keySalt',
        userKey: 'key'
      });
    });
  });

  describe('modifyPermissionsHandler', () => {
    test('modifies permissions.', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser });
      mocked_db.getMemory().user_.items.push({ ...testUser, userId: 'otherId', username: 'otherUsername' });

      const response = await request(api)
        .post('/user/manage/modify-permissions')
        .send({ authorizedUser: { ...testUser, userManager: true }, userId: 'otherId', userManager: true, videoManager: false, admin: true });

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('updated');
      expect(mocked_db.getMemory().user_.items[1]).toEqual({
        ...testUser,
        userId: 'otherId',
        username: 'otherUsername',
        userManager: true,
        videoManager: false,
        admin: true
      });
    });

    test('responses error if user does not exist.', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api)
        .post('/user/manage/modify-permissions')
        .send({ authorizedUser: { ...testUser, userManager: true }, userId: 'otherId', userManager: true, videoManager: false, admin: true });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('not-updated');
    });
  });

  describe('modifyDisplayNameHandler', () => {
    test('modifies displayName.', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser });
      mocked_db.getMemory().user_.items.push({ ...testUser, userId: 'otherId', username: 'otherUsername' });

      const response = await request(api)
        .post('/user/manage/modify-displayname')
        .send({ authorizedUser: { ...testUser, userManager: true }, userId: 'otherId', displayName: 'newName' });

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('updated');
      expect(mocked_db.getMemory().user_.items[1]).toEqual({ ...testUser, userId: 'otherId', username: 'otherUsername', displayName: 'newName' });
    });

    test('responses error if user does not exist.', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api)
        .post('/user/manage/modify-displayname')
        .send({ authorizedUser: { ...testUser, userManager: true }, userId: 'nope', displayName: 'newName' });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('not-updated');
    });
  });

  describe('deleteUserHandler', () => {
    test('deletes user.', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api)
        .delete('/user/manage/delete/' + testUser.userId)
        .send({ authorizedUser: { ...testUser } });

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('deleted');
      expect(mocked_db.getMemory().user_.items.length).toBe(0);
    });

    test('responses error if user does not exist.', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api)
        .delete('/user/manage/delete/nope')
        .send({ authorizedUser: { ...testUser } });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('not-deleted');
      expect(mocked_db.getMemory().user_.items.length).toBe(1);
    });
  });

  describe('getUsersHandler', () => {
    test('gets all users', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser });
      mocked_db.getMemory().user_.items.push({ ...testUser, userId: 'otherId', username: 'otherUsername' });

      const response = await request(api)
        .get('/user/manage/get-users')
        .send({ authorizedUser: { ...testUser } });

      expect(response.status).toBe(200);
      expect(response.body?.users).toEqual([{ ...testUser }, { ...testUser, userId: 'otherId', username: 'otherUsername' }]);
    });
  });

  describe('loginHandler', () => {
    // noinspection SpellCheckingInspection
    const hash = 'hvMAotfYqXiBQjYItFh2JY5kUIL8zWXZGSJPF6goIi0=';

    test('logs user in.', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser, hash, salt: '01'.repeat(16), hashAlgorithm: 'scrypt' });

      const response = await request(api).post('/user/login').send({ username: testUser.username, password: 'abc' });

      expect(response.status).toBe(200);
      expect(response.body.token).toContain('ey');
      expect(response.body.token).toContain('.');
      expect(response.body.expires).toBeGreaterThan(0);
      expect(response.body.userKey).toEqual('testKey');
    });

    test('responses error if invalid username', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser, hash, salt: '01'.repeat(16), hashAlgorithm: 'scrypt' });

      const response = await request(api).post('/user/login').send({ username: '-', password: 'abc' });

      expect(response.status).toBe(401);
      expect(response.body.error).toEqual('invalid_login');
    });

    test('responses error if invalid password', async () => {
      const api = buildApi();
      mocked_db.getMemory().user_.items.push({ ...testUser, hash, salt: '01'.repeat(16), hashAlgorithm: 'scrypt' });

      const response = await request(api).post('/user/login').send({ username: testUser.username, password: 'xyz' });

      expect(response.status).toBe(401);
      expect(response.body.error).toEqual('invalid_login');
    });

    test('responses error if login for username is locked', async () => {
      const api = buildApi();
      const lock: Lock = { username: testUser.username, attempts: 6, lastAttempt: new Date() };
      mocked_db.getMemory().user_.items.push({ ...testUser, hash, salt: '01'.repeat(16), hashAlgorithm: 'scrypt' });
      mocked_db.getMemory().lock.items.push(lock as unknown as DbItem);

      const response = await request(api).post('/user/login').send({ username: testUser.username, password: 'abc' });

      expect(response.status).toBe(401);
      expect(response.body.error).toEqual('invalid_login');
    });
  });
});
