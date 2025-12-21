import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { initJwt, issueToken, resetKeys } from '@/auth/jwt';
import { authenticate, authorize, hashPassword } from '@/auth';
import { User } from '@/user/types/User';

const username = 'testUser';
const password = 'testPwd';
const hashAlgorithm = 'scrypt';
const hashSalt = 'YWFhYWFhYWFhYWFhYWFhYQ==';
// noinspection SpellCheckingInspection
const hash = 'O8fICNHvM2AlfcoaHUamNo5JQJamdZMz0YXMLrnoH/w=';
const userId = 'test-id';

let mocked_called_count = false;
let mocked_called_reset = false;
let mocked_locked = false;
const mocked_db = new InMemoryDatabaseAdapter();

jest.mock('@/db', () => {
  return {
    async loadDb() {
      return mocked_db;
    }
  };
});

jest.mock('@/auth/jwt', () => {
  const actual = jest.requireActual('@/auth/jwt');
  // noinspection JSUnusedGlobalSymbols - used outside
  return {
    ...actual,
    issueToken(id: string) {
      if (id.startsWith('real_')) {
        return actual.issueToken(id.substring(5));
      }
      return `token for ${id}`;
    },
    verifyToken(token: string | null) {
      if (token?.startsWith('valid_')) {
        return true;
      }
      if (token?.startsWith('invalid_')) {
        return false;
      }
      return actual.verifyToken(token);
    },
    extractUsername(token: string) {
      if (token?.startsWith('valid_')) {
        return token.substring(6);
      }
      return actual.extractUsername(token);
    }
  };
});

jest.mock('@/auth/locking', () => {
  // noinspection JSUnusedGlobalSymbols - used outside
  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async countAttempt(_username: string) {
      mocked_called_count = true;
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async resetAttempts(_username: string) {
      mocked_called_reset = true;
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async handleLocking(_username: string) {
      return mocked_locked;
    }
  };
});

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    randomBytes(size: number) {
      return Buffer.from('a'.repeat(size), 'utf8');
    }
  };
});

describe('auth', (): void => {
  beforeAll(() => {
    mocked_db.getMemory().lock = {
      name: 'lock',
      key: '',
      fields: {},
      items: []
    };
    mocked_db.getMemory().user_ = {
      name: 'user_',
      key: '',
      fields: {},
      items: []
    };
    mocked_db.getMemory().jwtkey = {
      name: 'jwtkey',
      key: '',
      fields: {},
      items: []
    };
  });

  beforeEach(async (): Promise<void> => {
    mocked_db.getMemory().user_.items = [];
    await initJwt();
    mocked_called_count = false;
    mocked_called_reset = false;
    mocked_locked = false;
  });

  afterEach(async (): Promise<void> => {
    resetKeys();
  });

  describe('authenticate', () => {
    test('authenticate returns token on valid credentials.', async (): Promise<void> => {
      mocked_locked = false;
      mocked_db.getMemory().user_.items[0] = { username, hashAlgorithm, hashSalt, hash, userId, admin: true, meta: {} };

      const result = await authenticate(username, password);

      expect(result).toBe(`token for ${userId}`);
      expect(mocked_called_count).toBe(false);
      expect(mocked_called_reset).toBe(true);
    });

    test('authenticate returns invalidCredentials on invalid password.', async (): Promise<void> => {
      mocked_db.getMemory().user_.items[0] = { username, hashAlgorithm, hashSalt, hash, userId, admin: true, meta: {} };
      mocked_locked = false;

      const result = await authenticate(username, 'invalid');

      expect(result).toBeNull();
      expect(mocked_called_count).toBe(true);
      expect(mocked_called_reset).toBe(false);
    });

    test('authenticate returns invalidCredentials on invalid username.', async (): Promise<void> => {
      mocked_db.getMemory().user_.items[0] = { username, hashAlgorithm, hashSalt, hash, userId, admin: true, meta: {} };
      mocked_locked = false;

      const result = await authenticate('invalid', password);

      expect(result).toBeNull();
      expect(mocked_called_count).toBe(true);
      expect(mocked_called_reset).toBe(false);
    });

    test('authenticate returns invalidCredentials on invalid credentials.', async (): Promise<void> => {
      mocked_db.getMemory().user_.items[0] = { username, hashAlgorithm, hashSalt, hash, userId, admin: true, meta: {} };
      mocked_locked = false;

      const result = await authenticate('invalid', 'invalid');

      expect(result).toBeNull();
      expect(mocked_called_count).toBe(true);
      expect(mocked_called_reset).toBe(false);
    });

    test('authenticate returns attemptsExceeded if locked.', async (): Promise<void> => {
      mocked_db.getMemory().user_.items[0] = { username, hashAlgorithm, hashSalt, hash, userId, admin: true, meta: {} };
      mocked_locked = true;

      const result = await authenticate(username, password);

      expect(result).toBeNull();
      expect(mocked_called_count).toBe(false);
      expect(mocked_called_reset).toBe(false);
    });
  });

  describe('authorize', () => {
    test('authorize returns user if logged in.', async (): Promise<void> => {
      mocked_db.getMemory().user_.items[0] = { username, hashAlgorithm, hashSalt, hash, userId, admin: true, meta: {} };
      const token = issueToken(`real_${userId}`);

      const user = await authorize(token);

      expect(user?.username).toBe(username);
      expect(mocked_called_count).toBe(false);
      expect(mocked_called_reset).toBe(false);
    });

    test('authorize returns null if logged-in user does not exist.', async (): Promise<void> => {
      mocked_db.getMemory().user_.items[0] = { username, hashAlgorithm, hashSalt, hash, userId, admin: true, meta: {} };
      const token = issueToken(`real_other`);

      const user = await authorize(token);

      expect(user).toBeNull();
      expect(mocked_called_count).toBe(false);
      expect(mocked_called_reset).toBe(false);
    });

    test('authorize returns null if token is invalid.', async (): Promise<void> => {
      const token = issueToken(`real_${userId}`);

      const user = await authorize(token.substring(0, token.length - 2));

      expect(user).toBeNull();
      expect(mocked_called_count).toBe(false);
      expect(mocked_called_reset).toBe(false);
    });

    test('authorize returns null if token is empty.', async (): Promise<void> => {
      const user = await authorize('');

      expect(user).toBeNull();
      expect(mocked_called_count).toBe(false);
      expect(mocked_called_reset).toBe(false);
    });

    test('authorize returns null if no token.', async (): Promise<void> => {
      const user = await authorize(null);

      expect(user).toBeNull();
      expect(mocked_called_count).toBe(false);
      expect(mocked_called_reset).toBe(false);
    });
  });

  test('hashPassword changes password.', async (): Promise<void> => {
    mocked_db.getMemory().user_.items[0] = { username, hashVersion: '', salt: '', hash: '', userId, admin: true, meta: {} };

    const [salt, hash, algorithm] = await hashPassword(password);

    expect(salt).toEqual(hashSalt);
    expect(hash).toBe(hash);
    expect(algorithm).toBe('scrypt');
  });
});
