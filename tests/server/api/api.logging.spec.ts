import { unlink } from 'fs/promises';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { deleteDirectory, exists } from '#/util';
import { initJwt, issueToken } from '@/auth/jwt';
import { buildApi } from '@/server/api';
import request from 'supertest';
import { User } from '@/user/types/User';
import { AuthorizedUserRequest } from '@/server/types/AuthorizedUserRequest';
import { AccessLogEntry } from '@/logging/types/AccessLogEntry';

const mocked_db = new InMemoryDatabaseAdapter();
let mocked_lastLogEntry: AccessLogEntry | null = null;

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
      public access(entry: AccessLogEntry): Logger {
        mocked_lastLogEntry = entry;
        return this;
      }
    }
  };
});

describe('api logging', () => {
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
    mocked_lastLogEntry = null;
  });

  test('logs on success.', async () => {
    mocked_db.getMemory().user_.items.push({ ...testUser });
    await initJwt();
    const token = issueToken(testUser.userId);
    const api = buildApi(false);
    api.post('/api/test', (req, res) => {
      res.status(200).json({ authorizedUser: (req as AuthorizedUserRequest).authorizedUser });
    });

    await request(api)
      .post('/api/test')
      .set('authorize', 'Bearer ' + token);

    expect({ ...mocked_lastLogEntry, time: 0 }).toEqual({
      contentLength: 265,
      httpVersion: 'HTTP/1.1',
      ip: '::ffff:127.0.0.1',
      method: 'POST',
      path: '/api/test',
      referer: '_',
      statusCode: 200,
      userAgent: '_',
      time: 0,
      error: undefined
    });
    expect(mocked_lastLogEntry?.time).toBeGreaterThanOrEqual(0);
    expect(mocked_lastLogEntry?.time).toBeLessThanOrEqual(1000);
  });

  test('logs unauthorized.', async () => {
    mocked_db.getMemory().user_.items.push({ ...testUser });
    await initJwt();
    const api = buildApi(false);
    api.post('/api/test', (req, res) => {
      res.status(200).json({ authorizedUser: (req as AuthorizedUserRequest).authorizedUser });
    });

    await request(api).post('/api/test');

    expect({ ...mocked_lastLogEntry, time: 0 }).toEqual({
      contentLength: 24,
      httpVersion: 'HTTP/1.1',
      ip: '::ffff:127.0.0.1',
      method: 'POST',
      path: '/api/test',
      referer: '_',
      statusCode: 401,
      userAgent: '_',
      time: 0,
      error: 'unauthorized'
    });
    expect(mocked_lastLogEntry?.time).toBeGreaterThanOrEqual(0);
    expect(mocked_lastLogEntry?.time).toBeLessThanOrEqual(1000);
  });
});
