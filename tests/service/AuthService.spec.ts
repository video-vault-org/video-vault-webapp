import { createHash } from 'node:crypto';
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
  let db: InMemoryDatabaseAdapter;
  let service: AuthService;

  beforeAll(async () => {
    user.loginHash = await hashPassword(loginHash);
  });

  beforeEach(async () => {
    db = new InMemoryDatabaseAdapter();
    await db.createUser(user);
    service = new AuthService(db);
  });

  afterEach(async () => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const seedAttempts = async function (count: number, lastAttempt = start, name = username): Promise<void> {
    for (let index = 0; index < count; index++) {
      await db.increaseAttemptsCountByUsername({ username: name, lastAttempt });
    }
  };

  test('requires initialization and validates lifetime', async () => {
    await expect(service.login({ username, loginHash })).rejects.toThrow('not initialized');
    await expect(service.authenticate({ sessionId: 'invalid' })).rejects.toThrow('not initialized');
    await expect(service.verifyCurrentPassword({ userId, loginHash })).rejects.toThrow('not initialized');
    for (const sessionLifetimeSeconds of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) expect(() => new AuthService(db, { sessionLifetimeSeconds })).toThrow(RangeError);
  });

  describe('initialized service', () => {
    beforeEach(async () => {
      await Promise.all([service.initialize(), service.initialize()]);
      jest.useFakeTimers({ now: start, doNotFake: ['nextTick', 'setImmediate'] });
    });

    describe('verifyCurrentPassword', () => {
      test('verifies the current proof without issuing a token and clears failed attempts', async () => {
        await db.increaseAttemptsCountByUsername({ username, lastAttempt: start });
        const sign = jest.spyOn(db, 'createSession');
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
      test('creates unique opaque credentials and persists only their digests', async () => {
        const create = jest.spyOn(db, 'createSession');
        const first = (await service.login({ username, loginHash }))!;
        const second = (await service.login({ username, loginHash }))!;
        expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(second).not.toBe(first);
        expect(create.mock.calls[0][0]).toEqual({ sessionId: createHash('sha256').update(first).digest('hex'), userId, version: expect.stringMatching(/^[a-f0-9]{64}$/), expiresAt: start.getTime() + 3600_000 });
        expect(await service.authenticate({ sessionId: first })).toEqual(user);
        expect(await service.findSession({ sessionId: first })).toEqual({ user, expiresAt: start.getTime() + 3600_000, csrfToken: service.csrfToken(first) });
        expect(service.csrfToken(first)).not.toBe(first);
        expect(await service.authenticate({ sessionId: service.csrfToken(first) })).toBeNull();
      });

      test('persists sessions across service restarts and enforces exact expiry', async () => {
        const short = new AuthService(db, { sessionLifetimeSeconds: 60 });
        await short.initialize();
        const sessionId = (await short.login({ username, loginHash }))!;
        const restarted = new AuthService(db);
        await restarted.initialize();
        jest.setSystemTime(start.getTime() + 59_999);
        expect(await restarted.authenticate({ sessionId })).toEqual(user);
        jest.setSystemTime(start.getTime() + 60_000);
        expect(await restarted.authenticate({ sessionId })).toBeNull();
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

    test('logout revokes only one session and is idempotent', async () => {
      const first = (await service.login({ username, loginHash }))!;
      const second = (await service.login({ username, loginHash }))!;
      await service.logout({ sessionId: first });
      await service.logout({ sessionId: first });
      expect(await service.authenticate({ sessionId: first })).toBeNull();
      expect(await service.authenticate({ sessionId: second })).toEqual(user);
    });

    test('logout everywhere revokes old sessions across restarts but permits a new login', async () => {
      const first = (await service.login({ username, loginHash }))!;
      const second = (await service.login({ username, loginHash }))!;
      await service.logoutEverywhere({ userId });
      const restarted = new AuthService(db);
      await restarted.initialize();
      expect(await restarted.authenticate({ sessionId: first })).toBeNull();
      expect(await restarted.authenticate({ sessionId: second })).toBeNull();
      expect(await restarted.authenticate({ sessionId: (await restarted.login({ username, loginHash }))! })).toEqual(user);
    });

    test('deleting and recreating a user cannot revive their sessions', async () => {
      const sessionId = (await service.login({ username, loginHash }))!;
      await new UserService(db).deleteUser({ userId });
      await db.createUser(user);
      expect(await service.authenticate({ sessionId })).toBeNull();
    });

    test.each(['password', 'username'] as const)('%s changes revoke every existing session of only the changed user', async (kind) => {
      const users = new UserService(db);
      await db.createUser({ ...user, userId: 'other', username: 'other' });
      const first = (await service.login({ username, loginHash }))!;
      const second = (await service.login({ username, loginHash }))!;
      const other = (await service.login({ username: 'other', loginHash }))!;
      if (kind === 'password') await users.changeUsersPassword({ userId, loginHash: wrongHash, passwordKeySalt: 'new-salt', userKey: 'new-key' });
      else await users.changeUsersUsername({ userId, username: 'renamed', loginHash: wrongHash });
      expect(await service.authenticate({ sessionId: first })).toBeNull();
      expect(await service.authenticate({ sessionId: second })).toBeNull();
      expect(await service.authenticate({ sessionId: other })).toMatchObject({ userId: 'other' });
      const fresh = await service.login({ username: kind === 'username' ? 'renamed' : username, loginHash: wrongHash });
      expect(await service.authenticate({ sessionId: fresh! })).toMatchObject({ userId });
    });

    test.each(['password', 'username'] as const)('rejects sessions issued by a login verified before a concurrent %s change', async (kind) => {
      const read = db.findSessionVersionByUserId.bind(db);
      jest.spyOn(db, 'findSessionVersionByUserId').mockImplementationOnce(async (parameters) => {
        const users = new UserService(db);
        if (kind === 'password') await users.changeUsersPassword({ userId, loginHash: wrongHash, passwordKeySalt: 'new-salt', userKey: 'new-key' });
        else await users.changeUsersUsername({ userId, username: 'renamed', loginHash: wrongHash });
        return read(parameters);
      });
      const stale = (await service.login({ username, loginHash }))!;
      expect(await service.authenticate({ sessionId: stale })).toBeNull();
      expect(await service.authenticate({ sessionId: (await service.login({ username: kind === 'username' ? 'renamed' : username, loginHash: wrongHash }))! })).toMatchObject({ userId });
    });

    test('failed credential updates leave existing sessions valid', async () => {
      const sessionId = (await service.login({ username, loginHash }))!;
      await db.createUser({ ...user, userId: 'other', username: 'other' });
      await expect(new UserService(db).changeUsersUsername({ userId, username: 'other', loginHash: wrongHash })).rejects.toThrow();
      jest.spyOn(db, 'changeUsersPasswordByUserId').mockRejectedValueOnce(new Error('Unavailable'));
      await expect(new UserService(db).changeUsersPassword({ userId, loginHash: wrongHash, passwordKeySalt: 'new', userKey: 'new' })).rejects.toThrow('Unavailable');
      expect(await service.authenticate({ sessionId })).toEqual(user);
    });

    test('loads current roles and rejects deleted users, random credentials and malformed values', async () => {
      const sessionId = (await service.login({ username, loginHash }))!;
      await db.changeUsersEditorRoleByUserId({ userId, editor: true });
      expect(await service.authenticate({ sessionId })).toMatchObject({ editor: true });
      for (const id of ['', 'a.b.c', 'x'.repeat(43), 'Bearer token']) expect(await service.authenticate({ sessionId: id })).toBeNull();
      await db.deleteUserByUserId({ userId });
      expect(await service.authenticate({ sessionId })).toBeNull();
    });

    test('propagates session persistence and revocation failures', async () => {
      const error = new Error('Unavailable');
      jest.spyOn(db, 'createSession').mockRejectedValueOnce(error);
      await expect(service.login({ username, loginHash })).rejects.toBe(error);
      jest.spyOn(db, 'findSessionById').mockRejectedValueOnce(error);
      await expect(service.findSession({ sessionId: 'a'.repeat(43) })).rejects.toBe(error);
      jest.spyOn(db, 'deleteSessionById').mockRejectedValueOnce(error);
      await expect(service.logout({ sessionId: 'a'.repeat(43) })).rejects.toBe(error);
      jest.spyOn(db, 'changeSessionVersionByUserId').mockRejectedValueOnce(error);
      await expect(service.logoutEverywhere({ userId })).rejects.toBe(error);
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
