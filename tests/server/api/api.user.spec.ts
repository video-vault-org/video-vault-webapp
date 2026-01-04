import request from 'supertest';
import express from 'express';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { initJwt } from '@/auth/jwt';
import { buildUserApi } from '@/server/api/userApi';
import { User } from '@/user/types/User';
import { AuthorizedUserRequest } from '@/server/types/AuthorizedUserRequest';
import { AuthorizedInitRequest } from '@/server/types/AuthorizedInitRequest';

const mocked_db = new InMemoryDatabaseAdapter();

jest.mock('@/db', () => {
  // noinspection JSUnusedGlobalSymbols used as mock
  return {
    async loadDb() {
      return mocked_db;
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
  const testUser: User = {
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

  const buildApi = function (userManager: boolean, init: boolean) {
    const userApi = buildUserApi();
    const api = express();
    api.use(async (req, _, next) => {
      if (init) {
        (req as AuthorizedInitRequest).authorizedInit = true;
      }
      (req as AuthorizedUserRequest).authorizedUser = { ...testUser, userManager };
      next();
    });
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
    delete mocked_db.getMemory().lock;
  });

  describe('userManagerHandler', () => {
    test('calls next if user is user manager.', async () => {
      const api = buildApi(true, false);
      api.post('/user/manage/test', (_, res) => {
        res.status(200).json({ message: 'ok' });
      });

      const response = await request(api).post('/user/manage/test');

      expect(response.status).toBe(200);
      expect(response.body?.message).toEqual('ok');
    });

    test('calls next if is init.', async () => {
      const api = buildApi(false, true);
      api.post('/user/manage/test', (_, res) => {
        res.status(200).json({ message: 'ok' });
      });

      const response = await request(api).post('/user/manage/test');

      expect(response.status).toBe(200);
      expect(response.body?.message).toEqual('ok');
    });

    test('responses error if user is not user manager.', async () => {
      const api = buildApi(false, false);
      api.post('/user/manage/test', (_, res) => {
        res.status(200).json({ message: 'ok' });
      });

      const response = await request(api).post('/user/manage/test');

      expect(response.status).toBe(403);
      expect(response.body?.error).toEqual('forbidden');
    });
  });

  describe('addUserHandler', () => {
    test('adds user.', async () => {
      const api = buildApi(true, false);

      const response = await request(api)
        .post('/user/manage/add')
        .send({ user: { ...testUser, userId: 'newId' }, password: 'pwd' });

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
      const api = buildApi(true, false);
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api)
        .post('/user/manage/add')
        .send({ user: { ...testUser }, password: 'pwd' });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('user-exists-with-id');
      expect(mocked_db.getMemory().user_.items.length).toBe(1);
    });

    test('responses error if user already exists by username.', async () => {
      const api = buildApi(true, false);
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api)
        .post('/user/manage/add')
        .send({ user: { ...testUser, userId: 'newId' }, password: 'pwd' });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('user-exists-with-username');
      expect(mocked_db.getMemory().user_.items.length).toBe(1);
    });
  });

  describe('modifyUsernameHandler', () => {
    test('modifies username.', async () => {
      const api = buildApi(true, false);
      mocked_db.getMemory().user_.items.push({ ...testUser });
      mocked_db.getMemory().user_.items.push({ ...testUser, userId: 'otherId', username: 'otherUsername' });

      const response = await request(api).post('/user/manage/modify-username').send({ userId: 'otherId', username: 'newUsername' });

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('updated');
      expect(mocked_db.getMemory().user_.items[1]).toEqual({ ...testUser, userId: 'otherId', username: 'newUsername' });
    });

    test('responses error if user does not exist.', async () => {
      const api = buildApi(true, false);
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api).post('/user/manage/modify-username').send({ userId: 'otherId', username: 'newUsername' });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('no-such-user');
    });
  });

  describe('modifyOwnUsernameHandler', () => {
    test('modifies username.', async () => {
      const api = buildApi(false, false);
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api).post('/user/modify-username').send({ username: 'newUsername' });

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('updated');
      expect(mocked_db.getMemory().user_.items[0]).toEqual({ ...testUser, username: 'newUsername' });
    });
  });

  describe('modifyCredentialsHandler', () => {
    test('modifies credentials.', async () => {
      const api = buildApi(true, false);
      mocked_db.getMemory().user_.items.push({ ...testUser });
      mocked_db.getMemory().user_.items.push({ ...testUser, userId: 'otherId', username: 'otherUsername' });

      const response = await request(api).post('/user/manage/modify-credentials').send({
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
      const api = buildApi(true, false);
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api).post('/user/manage/modify-credentials').send({
        userId: 'nope',
        username: 'un',
        password: 'pwd',
        passwordKeySalt: 'keySalt',
        userKey: 'key'
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('no-such-user');
    });
  });

  describe('modifyOwnCredentialsHandler', () => {
    test('modifies credentials.', async () => {
      const api = buildApi(false, false);
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api).post('/user/modify-credentials').send({
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
      const api = buildApi(true, false);
      mocked_db.getMemory().user_.items.push({ ...testUser });
      mocked_db.getMemory().user_.items.push({ ...testUser, userId: 'otherId', username: 'otherUsername' });

      const response = await request(api)
        .post('/user/manage/modify-permissions')
        .send({ userId: 'otherId', userManager: true, videoManager: false, admin: true });

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
      const api = buildApi(true, false);
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api)
        .post('/user/manage/modify-permissions')
        .send({ userId: 'otherId', userManager: true, videoManager: false, admin: true });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('no-such-user');
    });
  });

  describe('modifyDisplayNameHandler', () => {
    test('modifies displayName.', async () => {
      const api = buildApi(true, false);
      mocked_db.getMemory().user_.items.push({ ...testUser });
      mocked_db.getMemory().user_.items.push({ ...testUser, userId: 'otherId', username: 'otherUsername' });

      const response = await request(api).post('/user/manage/modify-displayname').send({ userId: 'otherId', displayName: 'newName' });

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('updated');
      expect(mocked_db.getMemory().user_.items[1]).toEqual({ ...testUser, userId: 'otherId', username: 'otherUsername', displayName: 'newName' });
    });

    test('responses error if user does not exist.', async () => {
      const api = buildApi(true, false);
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api).post('/user/manage/modify-displayname').send({ userId: 'nope', displayName: 'newName' });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('no-such-user');
    });
  });

  describe('deleteUserHandler', () => {
    test('deletes user.', async () => {
      const api = buildApi(true, false);
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api).delete('/user/manage/delete/' + testUser.userId);

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('deleted');
      expect(mocked_db.getMemory().user_.items.length).toBe(0);
    });

    test('responses error if user does not exist.', async () => {
      const api = buildApi(true, false);
      mocked_db.getMemory().user_.items.push({ ...testUser });

      const response = await request(api).delete('/user/manage/delete/nope');

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('no-such-user');
      expect(mocked_db.getMemory().user_.items.length).toBe(1);
    });
  });

  describe('getUsersHandler', () => {
    test('gets all users', async () => {
      const api = buildApi(true, false);
      mocked_db.getMemory().user_.items.push({ ...testUser });
      mocked_db.getMemory().user_.items.push({ ...testUser, userId: 'otherId', username: 'otherUsername' });

      const response = await request(api).get('/user/manage/get-users');

      expect(response.status).toBe(200);
      expect(response.body?.users).toEqual([{ ...testUser }, { ...testUser, userId: 'otherId', username: 'otherUsername' }]);
    });
  });
});
