import crypto, { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt, { SignOptions, JwtPayload } from 'jsonwebtoken';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { User } from '@/domain/User';
import { AuthService } from '@/service/AuthService';
import { UserService } from '@/service/UserService';
import { hashPassword } from '@/util/password';

describe('AuthService', () => {
  jest.setTimeout(30_000);
  const loginHash = Buffer.from('client-derived-password').toString('base64');
  const wrongHash = Buffer.from('wrong-password').toString('base64');
  const start = new Date('2026-01-01T00:00:00Z');
  const user: User = {
    userId: 'u1',
    username: 'alice',
    displayName: 'Alice',
    loginHash: '',
    passwordKeySalt: 'client-key-salt',
    userKey: 'encrypted-user-key',
    admin: true,
    editor: false,
    moderator: false
  };
  const { username, userId } = user;
  let directory: string;
  let keyDirectory: string;
  let db: InMemoryDatabaseAdapter;
  let service: AuthService;

  beforeAll(async () => {
    user.loginHash = await hashPassword(loginHash);
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'video-vault-auth-'));
    keyDirectory = join(directory, 'jwtkeys');
    db = new InMemoryDatabaseAdapter();
    await db.createUser(user);
    service = new AuthService(db, { keyDirectory });
  });

  afterEach(async () => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  const seedAttempts = async function (count: number, lastAttempt = start, name = username): Promise<void> {
    for (let index = 0; index < count; index++) {
      await db.increaseAttemptsCountByUsername({ username: name, lastAttempt });
    }
  };

  const signedToken = async function (payload: object = {}, options: SignOptions = {}): Promise<string> {
    const key = await readFile(join(keyDirectory, 'key-0.key'));
    return jwt.sign(payload, key, { algorithm: 'HS256', keyid: 'key-0', subject: userId, issuer: 'video-vault', audience: 'video-vault', expiresIn: 3600, ...options });
  };

  describe('constructor', () => {
    test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid tokenLifetimeSeconds %s', (tokenLifetimeSeconds) => {
      expect(() => new AuthService(db, { keyDirectory, tokenLifetimeSeconds })).toThrow(RangeError);
    });
  });

  describe('initialize', () => {
    test('creates ten distinct 256-bit keys with private directory and file permissions', async () => {
      await service.initialize();

      const files = await readdir(keyDirectory);
      expect(files).toHaveLength(10);
      const keys = [];
      for (const file of files) {
        const key = await readFile(join(keyDirectory, file));
        expect(key).toHaveLength(32);
        expect((await stat(join(keyDirectory, file))).mode & 0o777).toBe(0o600);
        keys.push(key.toString('hex'));
      }
      expect(new Set(keys).size).toBe(10);
      expect((await stat(keyDirectory)).mode & 0o777).toBe(0o700);
    });

    test('preserves existing keys and creates only missing files', async () => {
      await mkdir(keyDirectory);
      const existingKey = randomBytes(32);
      await writeFile(join(keyDirectory, 'key-3.key'), existingKey);
      await writeFile(join(keyDirectory, 'notes.txt'), 'unrelated');

      await Promise.all([service.initialize(), service.initialize()]);
      const original = await readFile(join(keyDirectory, 'key-0.key'));
      await service.initialize();

      expect(await readFile(join(keyDirectory, 'key-3.key'))).toEqual(existingKey);
      expect(await readFile(join(keyDirectory, 'key-0.key'))).toEqual(original);
      expect(await readFile(join(keyDirectory, 'notes.txt'), 'utf8')).toBe('unrelated');
      expect((await readdir(keyDirectory)).filter((file) => file.endsWith('.key'))).toHaveLength(10);
    });

    test('loads persisted keys after a service restart without changing them', async () => {
      await service.initialize();
      const token = await service.login({ username, loginHash });
      const original = await readFile(join(keyDirectory, 'key-0.key'));
      const restarted = new AuthService(db, { keyDirectory });

      await restarted.initialize();

      expect(await restarted.authenticate({ token: token! })).toEqual(user);
      expect(await readFile(join(keyDirectory, 'key-0.key'))).toEqual(original);
    });

    test('rejects malformed keys without replacing them and permits retry after repair', async () => {
      await mkdir(keyDirectory);
      const path = join(keyDirectory, 'key-0.key');
      await writeFile(path, 'invalid');

      await expect(service.initialize()).rejects.toThrow('Invalid JWT key');
      expect(await readFile(path, 'utf8')).toBe('invalid');
      await expect(service.login({ username, loginHash })).rejects.toThrow('not initialized');

      await writeFile(path, randomBytes(32));
      await service.initialize();
      expect(await service.login({ username, loginHash })).toEqual(expect.any(String));
    });

    test('propagates filesystem errors', async () => {
      await writeFile(keyDirectory, 'not a directory');

      await expect(service.initialize()).rejects.toThrow();
    });

    test('uses ./jwtkeys by default', async () => {
      const originalDirectory = process.cwd();
      process.chdir(directory);
      try {
        await new AuthService(db).initialize();
        expect(await readdir('./jwtkeys')).toHaveLength(10);
      } finally {
        process.chdir(originalDirectory);
      }
    });
  });

  test('login and authenticate require initialization', async () => {
    await expect(service.login({ username, loginHash })).rejects.toThrow('not initialized');
    await expect(service.authenticate({ token: 'invalid' })).rejects.toThrow('not initialized');
    await expect(service.verifyCurrentPassword({ userId, loginHash })).rejects.toThrow('not initialized');
  });

  describe('initialized service', () => {
    beforeEach(async () => {
      await service.initialize();
      jest.useFakeTimers({ now: start, doNotFake: ['nextTick', 'setImmediate'] });
    });

    describe('verifyCurrentPassword', () => {
      test('verifies the current proof without issuing a token and clears failed attempts', async () => {
        await db.increaseAttemptsCountByUsername({ username, lastAttempt: start });
        const sign = jest.spyOn(jwt, 'sign');
        expect(await service.verifyCurrentPassword({ userId, loginHash })).toBe(true);
        expect(sign).not.toHaveBeenCalled();
        expect(await db.findOneAttemptsCountByUsername({ username })).toBeNull();
      });

      test('rejects an unknown account and an incorrect current password', async () => {
        expect(await service.verifyCurrentPassword({ userId: 'unknown', loginHash })).toBe(false);
        expect(await service.verifyCurrentPassword({ userId, loginHash: wrongHash })).toBe(false);
        expect(await db.findOneAttemptsCountByUsername({ username })).toMatchObject({ attempts: 1 });
      });

      test('shares login locks, including concurrent failures and lock extension', async () => {
        const results = await Promise.all(Array.from({ length: 8 }, () => service.verifyCurrentPassword({ userId, loginHash: wrongHash })));
        expect(results).toEqual(Array(8).fill(false));
        expect(await db.findOneAttemptsCountByUsername({ username })).toMatchObject({ attempts: 5 });
        jest.setSystemTime(new Date(start.getTime() + 1000));
        expect(await service.verifyCurrentPassword({ userId, loginHash })).toBe(false);
        expect(await db.findOneAttemptsCountByUsername({ username })).toMatchObject({ attempts: 5, lastAttempt: new Date(start.getTime() + 1000) });
        expect(await service.login({ username, loginHash })).toBeNull();
        jest.setSystemTime(new Date(start.getTime() + 16_000));
        expect(await service.verifyCurrentPassword({ userId, loginHash })).toBe(true);
      });

      test('reads the latest stored password rather than trusting a previous authenticated profile', async () => {
        await db.changeUsersPasswordByUserId({ userId, loginHash: await hashPassword(wrongHash), passwordKeySalt: 'new', userKey: 'new' });
        expect(await service.verifyCurrentPassword({ userId, loginHash })).toBe(false);
        expect(await service.verifyCurrentPassword({ userId, loginHash: wrongHash })).toBe(true);
      });
    });

    describe('login', () => {
      test('signs an HS256 JWT with a known key and one-hour lifetime without exposing credentials', async () => {
        const token = await service.login({ username, loginHash });
        expect(token).toEqual(expect.any(String));
        const decoded = jwt.decode(token!, { complete: true })!;
        expect(decoded.header).toMatchObject({ alg: 'HS256', typ: 'JWT', kid: expect.stringMatching(/^key-[0-9]$/) });
        expect(decoded.payload).toEqual({ sub: userId, iss: 'video-vault', aud: 'video-vault', iat: start.getTime() / 1000, exp: start.getTime() / 1000 + 3600 });
        const key = await readFile(join(keyDirectory, `${decoded.header.kid}.key`));
        expect(jwt.verify(token!, key, { algorithms: ['HS256'] })).toEqual(decoded.payload);
        expect(await service.authenticate({ token: token! })).toEqual(user);
        expect(await db.findOneAttemptsCountByUsername({ username })).toBeNull();
      });

      test('supports a configurable JWT lifetime and rejects the token at its expiration', async () => {
        const shortLived = new AuthService(db, { keyDirectory, tokenLifetimeSeconds: 60 });
        await shortLived.initialize();
        const token = (await shortLived.login({ username, loginHash }))!;
        jest.setSystemTime(start.getTime() + 59_999);
        expect(await shortLived.authenticate({ token })).toEqual(user);
        jest.setSystemTime(start.getTime() + 60_000);
        expect(await shortLived.authenticate({ token })).toBeNull();
      });

      test('uses a randomly selected key when signing each JWT', async () => {
        const choose = jest
          .spyOn(crypto, 'randomInt')
          .mockImplementationOnce(() => 2)
          .mockImplementationOnce(() => 7);
        const first = await service.login({ username, loginHash });
        const second = await service.login({ username, loginHash });

        expect(jwt.decode(first!, { complete: true })!.header.kid).toBe('key-2');
        expect(jwt.decode(second!, { complete: true })!.header.kid).toBe('key-7');
        expect(choose).toHaveBeenCalledWith(10);
        expect(await service.authenticate({ token: first! })).toEqual(user);
        expect(await service.authenticate({ token: second! })).toEqual(user);
      });

      test.each([username, 'unknown-user'])('counts invalid credentials for %s without changing another counter', async (name) => {
        await seedAttempts(1, start, 'unrelated');
        await expect(service.login({ username: name, loginHash: wrongHash })).resolves.toBeNull();

        expect(await db.findOneAttemptsCountByUsername({ username: name })).toEqual({ username: name, attempts: 1, lastAttempt: start });
        expect(await db.findOneAttemptsCountByUsername({ username: 'unrelated' })).toEqual({ username: 'unrelated', attempts: 1, lastAttempt: start });
      });

      test('clears failed attempts after a successful login before the lock threshold', async () => {
        await seedAttempts(4);

        expect(await service.login({ username, loginHash })).toEqual(expect.any(String));
        expect(await db.findOneAttemptsCountByUsername({ username })).toBeNull();
      });

      test('does not lock below five failures if the clock moves behind the previous attempt', async () => {
        await seedAttempts(4, new Date(start.getTime() + 1000));

        expect(await service.login({ username, loginHash })).toEqual(expect.any(String));
        expect(await db.findOneAttemptsCountByUsername({ username })).toBeNull();
      });

      test('starts the first lock after exactly five failed password checks', async () => {
        for (let index = 0; index < 5; index++) {
          await expect(service.login({ username, loginHash: wrongHash })).resolves.toBeNull();
        }
        expect(await db.findOneAttemptsCountByUsername({ username })).toEqual({ username, attempts: 5, lastAttempt: start });
        const lookup = jest.spyOn(db, 'findOneUserByUsername');
        jest.setSystemTime(start.getTime() + 10_000);

        await expect(service.login({ username, loginHash })).resolves.toBeNull();

        expect(lookup).not.toHaveBeenCalled();
        expect(await db.findOneAttemptsCountByUsername({ username })).toEqual({ username, attempts: 5, lastAttempt: new Date(start.getTime() + 10_000) });
        jest.setSystemTime(start.getTime() + 25_000);
        expect(await service.login({ username, loginHash })).toEqual(expect.any(String));
        expect(await db.findOneAttemptsCountByUsername({ username })).toBeNull();
      });

      test.each([
        [5, 15_000],
        [6, 30_000],
        [7, 60_000],
        [8, 120_000],
        [9, 240_000],
        [10, 480_000],
        [11, 900_000],
        [1000, 900_000]
      ])('restarts the %s-attempt lock for %s ms without incrementing, and allows a new failure at expiry', async (count, duration) => {
        await seedAttempts(count);
        const blockedAt = start.getTime() + duration - 1;
        jest.setSystemTime(blockedAt);

        await expect(service.login({ username, loginHash })).resolves.toBeNull();

        expect(await db.findOneAttemptsCountByUsername({ username })).toEqual({ username, attempts: count, lastAttempt: new Date(blockedAt) });
        jest.setSystemTime(blockedAt + duration);
        await expect(service.login({ username, loginHash: wrongHash })).resolves.toBeNull();
        expect(await db.findOneAttemptsCountByUsername({ username })).toEqual({ username, attempts: count + 1, lastAttempt: new Date(blockedAt + duration) });
      });

      test('restarts an unknown username lock without looking up a user', async () => {
        await seedAttempts(5, start, 'unknown-user');
        const lookup = jest.spyOn(db, 'findOneUserByUsername');
        jest.setSystemTime(start.getTime() + 1000);

        await expect(service.login({ username: 'unknown-user', loginHash })).resolves.toBeNull();

        expect(lookup).not.toHaveBeenCalled();
        expect(await db.findOneAttemptsCountByUsername({ username: 'unknown-user' })).toEqual({ username: 'unknown-user', attempts: 5, lastAttempt: new Date(start.getTime() + 1000) });
      });

      test('isolates username locks and removes only the successful username counter', async () => {
        const other = { ...user, userId: 'u2', username: 'bob' };
        await db.createUser(other);
        await seedAttempts(5);
        await seedAttempts(3, start, other.username);

        const [blocked, success] = await Promise.all([service.login({ username, loginHash }), service.login({ username: other.username, loginHash })]);

        expect(blocked).toBeNull();
        expect(success).toEqual(expect.any(String));
        expect(await db.findOneAttemptsCountByUsername({ username })).toMatchObject({ attempts: 5 });
        expect(await db.findOneAttemptsCountByUsername({ username: other.username })).toBeNull();
      });

      test('serializes concurrent logins within the instance so blocked attempts do not increase the counter', async () => {
        const results = await Promise.all(Array.from({ length: 20 }, () => service.login({ username, loginHash: wrongHash })));

        expect(results).toEqual(Array(20).fill(null));
        expect(await db.findOneAttemptsCountByUsername({ username })).toEqual({ username, attempts: 5, lastAttempt: start });
      });

      test('allows an already queued login to continue after a database failure', async () => {
        const error = new Error('Database unavailable');
        jest.spyOn(db, 'findOneAttemptsCountByUsername').mockRejectedValueOnce(error);

        const first = service.login({ username, loginHash });
        const queued = service.login({ username, loginHash: wrongHash });

        await expect(first).rejects.toBe(error);
        await expect(queued).resolves.toBeNull();
        expect(await db.findOneAttemptsCountByUsername({ username })).toMatchObject({ attempts: 1 });
      });

      test.each(['findOneUserByUsername', 'increaseAttemptsCountByUsername', 'clearAttemptsCountByUsername'] as const)('propagates %s failures', async (method) => {
        const error = new Error('Database unavailable');
        jest.spyOn(db, method).mockRejectedValueOnce(error);

        await expect(service.login({ username, loginHash: method === 'increaseAttemptsCountByUsername' ? wrongHash : loginHash })).rejects.toBe(error);
      });

      test('propagates failure to restart an active lock', async () => {
        await seedAttempts(5);
        const error = new Error('Database unavailable');
        jest.spyOn(db, 'changeAttemptsLastAttemptByUsername').mockRejectedValueOnce(error);

        await expect(service.login({ username, loginHash })).rejects.toBe(error);
      });

      test('works with users created and passwords changed through UserService', async () => {
        const users = new UserService(db);
        const newUser = { ...user, userId: 'u3', username: 'carol', loginHash };
        await users.createUser(newUser);
        expect(await service.login({ username: newUser.username, loginHash })).toEqual(expect.any(String));

        await users.changeUsersPassword({ userId: newUser.userId, loginHash: wrongHash, passwordKeySalt: 'new-salt', userKey: 'new-key' });

        expect(await service.login({ username: newUser.username, loginHash })).toBeNull();
        expect(await service.login({ username: newUser.username, loginHash: wrongHash })).toEqual(expect.any(String));
        expect(await db.findOneAttemptsCountByUsername({ username: newUser.username })).toBeNull();
      });
    });

    describe('authenticate', () => {
      test.each(['', 'not-a-jwt', 'a.b.c', 'eyJhbGciOiJIUzI1NiJ9.!.!', 'Bearer token'])('rejects malformed token %s', async (token) => {
        await expect(service.authenticate({ token })).resolves.toBeNull();
      });

      test('rejects altered claims and an invalid signature', async () => {
        const token = await signedToken();
        const [header, , signature] = token.split('.');
        const payload = Buffer.from(JSON.stringify({ sub: 'attacker', exp: start.getTime() / 1000 + 3600 })).toString('base64url');
        expect(await service.authenticate({ token: `${header}.${payload}.${signature}` })).toBeNull();
        const forged = jwt.sign({ sub: userId } as JwtPayload, randomBytes(32), { algorithm: 'HS256', keyid: 'key-0', expiresIn: 3600 });
        expect(await service.authenticate({ token: forged })).toBeNull();
      });

      test.each(['none', 'HS384', 'HS512'] as const)('rejects the algorithm %s', async (algorithm) => {
        expect(await service.authenticate({ token: await signedToken({}, { algorithm }) })).toBeNull();
      });

      test.each(['unknown-key', '../../secret'])('rejects the unknown key ID %s', async (keyid) => {
        expect(await service.authenticate({ token: await signedToken({}, { keyid }) })).toBeNull();
      });

      test('rejects a missing key ID', async () => {
        const key = await readFile(join(keyDirectory, 'key-0.key'));
        const token = jwt.sign({ sub: userId } as JwtPayload, key, { algorithm: 'HS256', expiresIn: 3600 });
        expect(await service.authenticate({ token })).toBeNull();
      });

      test.each([{ issuer: 'foreign-app' }, { audience: 'foreign-app' }, { expiresIn: -1 }, { notBefore: 60 }])('rejects invalid token claims %j', async (options) => {
        expect(await service.authenticate({ token: await signedToken({}, options) })).toBeNull();
      });

      test('requires an expiration and a nonempty user ID', async () => {
        const key = await readFile(join(keyDirectory, 'key-0.key'));
        for (const payload of [{ sub: userId }, { exp: start.getTime() / 1000 + 3600 }, { sub: '', exp: start.getTime() / 1000 + 3600 }, { sub: 123, exp: start.getTime() / 1000 + 3600 }]) {
          const token = jwt.sign(payload, key, { algorithm: 'HS256', keyid: 'key-0', issuer: 'video-vault', audience: 'video-vault' });
          expect(await service.authenticate({ token })).toBeNull();
        }
      });

      test('loads the current user by ID, including updated roles and username', async () => {
        const token = await signedToken();
        await db.changeUsersAdminRoleByUserId({ userId, admin: false });
        await db.changeUsersEditorRoleByUserId({ userId, editor: true });
        await db.changeUsersUsernameByUserId({ userId, username: 'renamed', loginHash: user.loginHash });
        const lookup = jest.spyOn(db, 'findOneUserByUserId');

        const current = await service.authenticate({ token });

        expect(lookup).toHaveBeenCalledWith({ userId });
        expect(current).toEqual({ ...user, username: 'renamed', admin: false, editor: true });
        expect(service.authorize(current!)).toEqual(['editor']);
      });

      test('returns null after the user has been deleted', async () => {
        const token = await signedToken();
        await db.deleteUserByUserId({ userId });

        expect(await service.authenticate({ token })).toBeNull();
      });

      test('propagates database errors for a valid JWT', async () => {
        const error = new Error('Database unavailable');
        const token = await signedToken();
        jest.spyOn(db, 'findOneUserByUserId').mockRejectedValueOnce(error);

        await expect(service.authenticate({ token })).rejects.toBe(error);
      });
    });
  });

  describe('authorize', () => {
    test.each([
      [false, false, false, []],
      [true, false, false, ['admin']],
      [false, true, false, ['editor']],
      [false, false, true, ['moderator']],
      [true, true, false, ['admin', 'editor']],
      [true, false, true, ['admin', 'moderator']],
      [false, true, true, ['editor', 'moderator']],
      [true, true, true, ['admin', 'editor', 'moderator']]
    ])('returns only enabled roles for admin=%s editor=%s moderator=%s', (admin, editor, moderator, expected) => {
      const input = { ...user, admin: admin as boolean, editor: editor as boolean, moderator: moderator as boolean };
      expect(service.authorize(input)).toEqual(expected);
      expect(input).toEqual({ ...user, admin, editor, moderator });
    });
  });
});
