import { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '@/http/app';
import { AuthService } from '@/service/AuthService';
import { UserService } from '@/service/UserService';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { hashPassword } from '@/util/password';

const cookies = function (response: LightMyRequestResponse): string {
  const values = response.headers['set-cookie'];
  return (Array.isArray(values) ? values : [values ?? ''])
    .filter((value) => !value.includes('Max-Age=0'))
    .map((value) => value.split(';')[0])
    .join('; ');
};

describe('persistent cookie sessions and CSRF', () => {
  jest.setTimeout(30_000);
  let app: FastifyInstance, auth: AuthService, db: InMemoryDatabaseAdapter, users: UserService, directory: string, loginHash: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vault-sessions-'));
    await writeFile(join(directory, 'index.html'), '<title>Test</title>');
    loginHash = await hashPassword('proof');
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    db = new InMemoryDatabaseAdapter();
    users = new UserService(db);
    await db.createUser({ userId: 'u', username: 'alice', displayName: 'Alice', loginHash, userKey: 'wrapped', passwordKeySalt: 'salt', admin: true, editor: true, moderator: true });
    auth = new AuthService(db);
    await auth.initialize();
    app = createApp({ auth, users, videos: {} as never, comments: {} as never }, { instanceSalt: 'ab'.repeat(32), staticDirectory: directory, logger: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const login = async function () {
    const challenge = await app.inject('/session');
    expect(challenge.headers['cache-control']).toBe('no-store');
    const response = await app.inject({ method: 'POST', url: '/login', headers: { cookie: cookies(challenge), 'x-csrf-token': challenge.json().csrfToken }, payload: { username: 'alice', loginHash: 'proof' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: true, expiresAt: expect.any(Number), csrfToken: expect.any(String) });
    expect(response.json()).not.toHaveProperty('token');
    return { cookie: cookies(response), 'x-csrf-token': response.json().csrfToken };
  };

  test('uses host-only HttpOnly Secure Strict cookies and exposes only CSRF/expiry metadata', async () => {
    const headers = await login();
    expect(headers.cookie).toMatch(/^__Host-videovault-session=/);
    const result = await app.inject({ url: '/session', headers });
    expect(result.json().authenticated).toBe(true);
    expect(result.json().csrfToken).toBe(headers['x-csrf-token']);
    expect((await app.inject({ url: '/api/user/me', headers })).json().username).toBe('alice');
    const challenge = await app.inject('/session');
    const serialized = String(challenge.headers['set-cookie']);
    expect(serialized).toContain('HttpOnly');
    expect(serialized).toContain('Secure');
    expect(serialized).toContain('SameSite=Strict');
    expect(serialized).toContain('Path=/');
    expect(serialized).not.toContain('Domain=');
  });

  test('protects login against missing, invalid, duplicate-cookie and cross-origin challenges', async () => {
    const challenge = await app.inject('/session');
    for (const headers of [
      {},
      { cookie: cookies(challenge), 'x-csrf-token': 'wrong' },
      { cookie: `${cookies(challenge)}; ${cookies(challenge)}`, 'x-csrf-token': challenge.json().csrfToken },
      { cookie: cookies(challenge), 'x-csrf-token': challenge.json().csrfToken, origin: 'https://attacker.example' }
    ]) {
      expect((await app.inject({ method: 'POST', url: '/login', headers, payload: { username: 'alice', loginHash: 'proof' } })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: 'POST', url: '/login/', payload: { username: 'alice', loginHash: 'proof' } })).statusCode).toBe(403);
    expect(await db.findOneAttemptsCountByUsername({ username: 'alice' })).toBeNull();
  });

  test('rejects CSRF before body parsing for writes, multipart and binary packets, but allows authenticated reads', async () => {
    const headers = await login();
    const other = await login();
    for (const [method, url] of [
      ['PATCH', '/api/user/change/displayname/New'],
      ['POST', '/api/video/upload/v'],
      ['PUT', '/api/video/upload/v/session/video'],
      ['DELETE', '/api/user/delete'],
      ['POST', '/api/logout'],
      ['POST', '/api/logout-everywhere']
    ] as const) {
      for (const csrf of ['', other['x-csrf-token']]) expect((await app.inject({ method, url, headers: { cookie: headers.cookie, 'x-csrf-token': csrf }, payload: 'malformed' })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: 'PATCH', url: '/api/user/change/displayname/New', headers })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/user/me', headers: { cookie: headers.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/logout', headers: { ...headers, 'sec-fetch-site': 'cross-site' } })).statusCode).toBe(403);
  });

  test('normal logout revokes one session; everywhere logout revokes all and permits a fresh login', async () => {
    const first = await login(),
      second = await login();
    const result = await app.inject({ method: 'POST', url: '/api/logout', headers: first });
    expect(result.statusCode).toBe(204);
    expect(String(result.headers['set-cookie'])).toContain('Max-Age=0');
    expect((await app.inject({ url: '/api/user/me', headers: first })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/user/me', headers: second })).statusCode).toBe(200);
    const third = await login();
    expect((await app.inject({ method: 'POST', url: '/api/logout-everywhere', headers: second })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/user/me', headers: third })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/user/me', headers: await login() })).statusCode).toBe(200);
  });

  test('a new login rotates the current credential, and deleting the user revokes every session', async () => {
    const first = await login(),
      second = await login();
    const replacement = await app.inject({ method: 'POST', url: '/login', headers: first, payload: { username: 'alice', loginHash: 'proof' } });
    expect(replacement.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/user/me', headers: first })).statusCode).toBe(401);
    await users.deleteUser({ userId: 'u' });
    expect((await app.inject({ url: '/api/user/me', headers: second })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/user/me', headers: { cookie: cookies(replacement) } })).statusCode).toBe(401);
  });

  test.each([
    [undefined, 400],
    [{}, 400],
    [{ oldLoginHash: '' }, 400],
    [{ oldLoginHash: 123 }, 400],
    [{ oldLoginHash: 'x'.repeat(4097) }, 400],
    [{ oldLoginHash: 'proof', userId: 'other' }, 400],
    [{ oldLoginHash: 'wrong-proof' }, 403]
  ] as const)('self-deletion rejects invalid current-password proof %j without changing the account or comments', async (payload, status) => {
    const headers = await login();
    const remove = jest.spyOn(users, 'deleteUser');
    await db.postComment({ commentId: 'own-comment', userId: 'u', videoId: 'v', content: 'Keep this comment', created: new Date(), lastModified: new Date(), edited: false, deleted: false, hmac: 'hmac' });
    const response = await app.inject({ method: 'DELETE', url: '/api/user/delete', headers, payload });
    expect(response.statusCode).toBe(status);
    expect(remove).not.toHaveBeenCalled();
    expect(await db.findOneUserByUserId({ userId: 'u' })).not.toBeNull();
    expect(await db.findOneCommentByCommentId({ commentId: 'own-comment' })).toMatchObject({ content: 'Keep this comment', deleted: false });
    expect((await app.inject({ url: '/api/user/me', headers })).statusCode).toBe(200);
    const attempts = await db.findOneAttemptsCountByUsername({ username: 'alice' });
    if (status === 403) expect(attempts).toMatchObject({ attempts: 1 });
    else expect(attempts).toBeNull();
  });

  test('self-deletion respects the shared login lock even with the correct password proof', async () => {
    const headers = await login();
    const remove = jest.spyOn(users, 'deleteUser');
    for (let index = 0; index < 5; index++) await db.increaseAttemptsCountByUsername({ username: 'alice', lastAttempt: new Date() });
    const response = await app.inject({ method: 'DELETE', url: '/api/user/delete', headers, payload: { oldLoginHash: 'proof' } });
    expect(response.statusCode).toBe(403);
    expect(remove).not.toHaveBeenCalled();
    expect(await db.findOneAttemptsCountByUsername({ username: 'alice' })).toMatchObject({ attempts: 5 });
    expect(await db.findOneUserByUserId({ userId: 'u' })).not.toBeNull();
  });

  test('self-deletion clears the cookie immediately and invalidates all sessions', async () => {
    const first = await login(),
      second = await login();
    const deleted = await app.inject({ method: 'DELETE', url: '/api/user/delete', headers: first, payload: { oldLoginHash: 'proof' } });
    expect(deleted.statusCode).toBe(204);
    expect(String(deleted.headers['set-cookie'])).toContain('Max-Age=0');
    expect((await app.inject({ url: '/api/user/me', headers: second })).statusCode).toBe(401);
  });

  test.each([
    ['/api/user/change/password', { loginHash: 'new-proof', passwordKeySalt: 'new', userKey: 'new' }, 'u'],
    ['/api/user/change/password/u', { loginHash: 'new-proof', passwordKeySalt: 'new', userKey: 'new' }, 'u'],
    ['/api/user/change/username/renamed', { loginHash: 'new-proof' }, 'u'],
    ['/api/user/change/username/u/renamed', { loginHash: 'new-proof' }, 'u'],
    ['/api/user/change/password/target', { loginHash: 'new-proof', passwordKeySalt: 'new', userKey: 'new' }, 'target'],
    ['/api/user/change/username/target/renamed', { loginHash: 'new-proof' }, 'target']
  ] as const)('%s revokes all target sessions and keeps unrelated sessions valid', async (url, attributes, userId) => {
    await db.createUser({ userId: 'target', username: 'target', displayName: 'Target', loginHash, userKey: 'wrapped', passwordKeySalt: 'salt', admin: false, editor: false, moderator: false });
    const actor = await login();
    const targetFirst = (await auth.login({ username: userId === 'u' ? 'alice' : 'target', loginHash: 'proof' }))!;
    const targetSecond = (await auth.login({ username: userId === 'u' ? 'alice' : 'target', loginHash: 'proof' }))!;
    const unrelated = (await auth.login({ username: userId === 'u' ? 'target' : 'alice', loginHash: 'proof' }))!;
    const response = await app.inject({ method: 'PATCH', url, headers: actor, payload: { ...attributes, oldLoginHash: 'proof' } });
    expect(response.statusCode).toBe(204);
    expect(await auth.authenticate({ sessionId: targetFirst })).toBeNull();
    expect(await auth.authenticate({ sessionId: targetSecond })).toBeNull();
    expect(await auth.authenticate({ sessionId: unrelated })).not.toBeNull();
    if (userId === 'u') {
      expect(String(response.headers['set-cookie'])).toContain('Max-Age=0');
      expect((await app.inject({ url: '/api/user/me', headers: actor })).statusCode).toBe(401);
    } else {
      expect(response.headers['set-cookie']).toBeUndefined();
      expect((await app.inject({ url: '/api/user/me', headers: actor })).statusCode).toBe(200);
    }
    const newUsername = url.includes('/username/') ? 'renamed' : userId === 'u' ? 'alice' : 'target';
    expect(await auth.authenticate({ sessionId: (await auth.login({ username: newUsername, loginHash: 'new-proof' }))! })).toMatchObject({ userId });
  });

  test('does not accept Authorization bearer credentials or a CSRF token as a cookie credential', async () => {
    const headers = await login();
    expect((await app.inject({ url: '/api/user/me', headers: { authorization: `Bearer ${headers.cookie.split('=')[1]}` } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/user/me', headers: { cookie: `__Host-videovault-session=${headers['x-csrf-token']}` } })).statusCode).toBe(401);
  });

  test('the explicitly enabled development exception accepts only loopback connections and hostnames', async () => {
    await app.close();
    app = createApp({ auth, users, videos: {} as never, comments: {} as never }, { instanceSalt: 'ab'.repeat(32), staticDirectory: directory, insecureLocalCookies: true, logger: false });
    const response = await app.inject({ url: '/session', remoteAddress: '127.0.0.1', headers: { host: 'localhost:3210' } });
    expect(response.statusCode).toBe(200);
    expect(String(response.headers['set-cookie'])).not.toContain('; Secure');
    expect(String(response.headers['set-cookie'])).toContain('HttpOnly');
    expect((await app.inject({ url: '/session', remoteAddress: '192.0.2.1', headers: { host: 'localhost:3210' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/session', remoteAddress: '127.0.0.1', headers: { host: 'public.example' } })).statusCode).toBe(403);
  });
});
