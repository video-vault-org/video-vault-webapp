import { argon2id, hash } from 'argon2';
import crypto, { webcrypto } from 'node:crypto';
import prompts from 'prompts';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { initializeAdmin, readAdminInput } from '@/cli/admin';
import { verifyPassword } from '@/util/password';
import { ensureInstanceSalt } from '@/util/instanceSalt';
import { DatabaseConflictError } from '@/db/errors/DatabaseConflictError';

jest.mock('prompts', () => jest.fn());

jest.mock('@/util/instanceSalt', () => ({ ensureInstanceSalt: jest.fn() }));

const instanceSalt = 'ab'.repeat(32);

const input = { username: 'alice', displayName: 'Alice', password: 'P\u00e4ssword-123\ud83d\udd10' };
const uuid = '5eaef793-3886-49b1-8947-5216b6746fb3';
const existing = { userId: uuid, username: 'existing', displayName: 'Existing', loginHash: 'unused', passwordKeySalt: 'unused', userKey: 'unused', admin: false, editor: false, moderator: false };

describe('interactive admin initialization', () => {
  jest.setTimeout(30_000);
  let db: InMemoryDatabaseAdapter;

  beforeEach(() => {
    db = new InMemoryDatabaseAdapter();
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('OTHERHASH:1\r\n'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.mocked(prompts).mockReset();
    jest.mocked(ensureInstanceSalt).mockReset().mockResolvedValue(instanceSalt);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('asks for three attributes, masks the password and never prompts for the instance salt', async () => {
    jest.mocked(prompts).mockResolvedValueOnce(input);
    await expect(readAdminInput()).resolves.toEqual(input);
    expect(prompts).toHaveBeenCalledTimes(1);
    const questions = jest.mocked(prompts).mock.calls[0][0] as prompts.PromptObject[];
    expect(questions.map(({ name, type }) => ({ name, type }))).toEqual([
      { name: 'username', type: 'text' },
      { name: 'displayName', type: 'text' },
      { name: 'password', type: 'password' }
    ]);
  });

  test('rejects cancellation instead of accepting partial credentials', async () => {
    jest.mocked(prompts).mockImplementationOnce(async (questions, options) => {
      options?.onCancel?.((questions as prompts.PromptObject[])[0], {});
      return {};
    });

    await expect(readAdminInput()).rejects.toThrow('Admin initialization cancelled');
  });

  test('propagates prompt failures', async () => {
    const error = new Error('Terminal unavailable');
    jest.mocked(prompts).mockRejectedValueOnce(error);
    await expect(readAdminInput()).rejects.toBe(error);
  });

  test('rejects incomplete prompt results', async () => {
    jest.mocked(prompts).mockResolvedValueOnce({ username: 'alice' });
    await expect(readAdminInput()).rejects.toThrow();
  });

  test('creates a UUID v4, derives the loginHash and wraps independent AES and HMAC keys with a separately salted passwordKey', async () => {
    const salt = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
    const expectedAesKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 32));
    const expectedHmacKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 64));
    const random = jest
      .spyOn(crypto, 'randomBytes')
      .mockImplementationOnce(() => Buffer.from(salt))
      .mockImplementationOnce(() => Buffer.from(expectedAesKey))
      .mockImplementationOnce(() => Buffer.from(expectedHmacKey));
    await initializeAdmin(db, input);
    const [saved] = await db.findAllUsers();
    expect(saved.userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(saved).toMatchObject({ username: input.username, displayName: input.displayName, admin: true, editor: false, moderator: false });
    expect(saved).not.toHaveProperty('password');
    expect(saved).not.toHaveProperty('instanceSalt');
    expect(JSON.stringify(saved)).not.toContain(input.password);
    expect(JSON.stringify(saved)).not.toContain(instanceSalt);
    expect(saved.passwordKeySalt).toBe(salt.toString('base64'));
    expect(Buffer.from(saved.passwordKeySalt, 'base64')).toHaveLength(32);
    const wrappedKeys = Buffer.from(saved.userKey, 'base64');
    expect(wrappedKeys).toHaveLength(80);
    const wrappedAesKey = wrappedKeys.subarray(0, 40);
    const wrappedHmacKey = wrappedKeys.subarray(40);
    expect(wrappedAesKey).not.toEqual(wrappedHmacKey);

    const loginHash = await hash(input.password, { salt: Buffer.from(instanceSalt + input.username, 'utf8'), type: argon2id, version: 0x13, memoryCost: 19456, timeCost: 2, parallelism: 1, hashLength: 32, raw: true });
    expect(await verifyPassword(loginHash.toString('base64'), saved.loginHash)).toBe(true);
    expect(await verifyPassword(input.password, saved.loginHash)).toBe(false);

    // Verify interoperability with the browser AES-KW API using an independently derived key.
    const passwordKey = await hash(input.password, { salt, type: argon2id, version: 0x13, memoryCost: 19456, timeCost: 2, parallelism: 1, hashLength: 32, raw: true });
    const wrappingKey = await webcrypto.subtle.importKey('raw', Uint8Array.from(passwordKey), 'AES-KW', false, ['unwrapKey']);
    const unwrapped = await webcrypto.subtle.unwrapKey('raw', Uint8Array.from(wrappedAesKey), wrappingKey, 'AES-KW', { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    expect(Buffer.from(await webcrypto.subtle.exportKey('raw', unwrapped))).toEqual(expectedAesKey);
    const unwrappedHmac = await webcrypto.subtle.unwrapKey('raw', Uint8Array.from(wrappedHmacKey), wrappingKey, 'AES-KW', { name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify']);
    expect(Buffer.from(await webcrypto.subtle.exportKey('raw', unwrappedHmac))).toEqual(expectedHmacKey);
    const wrongKey = await webcrypto.subtle.importKey('raw', Uint8Array.from(loginHash), 'AES-KW', false, ['unwrapKey']);
    await expect(webcrypto.subtle.unwrapKey('raw', Uint8Array.from(wrappedAesKey), wrongKey, 'AES-KW', { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])).rejects.toThrow();
    await expect(webcrypto.subtle.unwrapKey('raw', Uint8Array.from(wrappedHmacKey), wrongKey, 'AES-KW', { name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify'])).rejects.toThrow();
    expect(random).toHaveBeenNthCalledWith(1, 32);
    expect(random).toHaveBeenNthCalledWith(2, 32);
    expect(random).toHaveBeenNthCalledWith(3, 32);
    expect(random.mock.results[1].value).toEqual(Buffer.alloc(32));
    expect(random.mock.results[2].value).toEqual(Buffer.alloc(32));
  });

  test('generates fresh IDs, salts and wrapped keys for independent initializations', async () => {
    const second = new InMemoryDatabaseAdapter();
    await initializeAdmin(db, input);
    await initializeAdmin(second, input);
    const [firstUser] = await db.findAllUsers();
    const [secondUser] = await second.findAllUsers();
    expect(firstUser.userId).not.toBe(secondUser.userId);
    expect(firstUser.passwordKeySalt).not.toBe(secondUser.passwordKeySalt);
    expect(firstUser.userKey).not.toBe(secondUser.userKey);
  });

  test('refuses initialization if any admin exists, without changing accounts', async () => {
    await db.createUser({ ...existing, admin: true });
    const saved = await db.findAllUsers();
    await expect(initializeAdmin(db, input)).rejects.toThrow('An admin already exists');
    expect(await db.findAllUsers()).toEqual(saved);
  });

  test('allows initialization when only non-admin accounts exist', async () => {
    await db.createUser(existing);
    await initializeAdmin(db, input);
    expect((await db.findAllUsers()).filter((user) => user.admin)).toHaveLength(1);
  });

  test.each([
    { ...input, admin: true },
    { ...input, userId: 'supplied-id' },
    { ...input, userKey: 'supplied-key' },
    { ...input, password: '' },
    { ...input, password: 'Short1!' },
    { ...input, password: 'alllowercaseletters' },
    { ...input, password: 'LowerAndUppercase' },
    { ...input, password: 'A1!' + 'x'.repeat(4094) },
    { ...input, instanceSalt: 'supplied-instanceSalt' },
    { ...input, username: 'ab' },
    { ...input, username: 'a' },
    { ...input, username: '' },
    { ...input, displayName: '' },
    {}
  ])('rejects invalid attributes or supplied IDs, keys and roles', async (value) => {
    await expect(initializeAdmin(db, value)).rejects.toThrow();
    expect(await db.findAllUsers()).toEqual([]);
  });

  test('refuses a generated ID collision without replacing the existing account', async () => {
    await db.createUser(existing);
    jest.spyOn(crypto, 'randomUUID').mockReturnValueOnce(uuid);
    await expect(initializeAdmin(db, input)).rejects.toThrow('User ID already exists');
    expect(await db.findAllUsers()).toEqual([existing]);
  });

  test('does not promote an existing non-admin with the same username', async () => {
    await db.createUser({ ...existing, username: input.username });
    await expect(initializeAdmin(db, input)).rejects.toBeInstanceOf(DatabaseConflictError);
    expect(await db.findAllUsers()).toEqual([{ ...existing, username: input.username }]);
  });

  test('clears both temporary random keys if database creation fails', async () => {
    const error = new Error('Write failed');
    const random = jest.spyOn(crypto, 'randomBytes');
    jest.spyOn(db, 'createUser').mockRejectedValueOnce(error);
    await expect(initializeAdmin(db, input)).rejects.toBe(error);
    expect(random.mock.results[1].value).toEqual(Buffer.alloc(32));
    expect(random.mock.results[2].value).toEqual(Buffer.alloc(32));
    expect(await db.findAllUsers()).toEqual([]);
  });

  test('does not create the admin if reading the instance salt fails', async () => {
    const error = new Error('Instance salt is unreadable');
    jest.mocked(ensureInstanceSalt).mockRejectedValueOnce(error);
    await expect(initializeAdmin(db, input)).rejects.toBe(error);
    expect(await db.findAllUsers()).toEqual([]);
  });

  test('accepts a username of exactly three characters and validates the prompt consistently', async () => {
    await initializeAdmin(db, { ...input, username: 'abc' });
    expect((await db.findAllUsers())[0].username).toBe('abc');
    jest.mocked(prompts).mockResolvedValueOnce(input);
    await readAdminInput();
    const question = (jest.mocked(prompts).mock.calls[0][0] as prompts.PromptObject[])[0];
    expect(await question.validate!('ab', {}, question)).toBe('Please enter 3 to 4096 characters');
    expect(await question.validate!('abc', {}, question)).toBe(true);
  });

  test('propagates database read errors', async () => {
    const error = new Error('DB unavailable');
    jest.spyOn(db, 'findAllUsers').mockRejectedValueOnce(error);
    await expect(initializeAdmin(db, input)).rejects.toBe(error);
  });

  test.each([
    ['Short1!', 'Please enter 12 to 4096 characters'],
    ['Aa1!' + 'x'.repeat(4093), 'Please enter 12 to 4096 characters'],
    ['LowerAndUppercase', 'Please use at least three character types: uppercase letters, lowercase letters, numbers, special characters'],
    ['lowercase12  ', 'Please use at least three character types: uppercase letters, lowercase letters, numbers, special characters'],
    ['Ää1234567890', true],
    ['lowercase12!', true],
    ['😀'.repeat(10) + 'Aa1', true],
    ['😀'.repeat(5) + 'Aa1!', 'Please enter 12 to 4096 characters'],
    ['Aa1!' + 'x'.repeat(4092), true]
  ])('validates password prompt strength for %j', async (password, expected) => {
    jest.mocked(prompts).mockResolvedValueOnce(input);
    await readAdminInput();
    const question = (jest.mocked(prompts).mock.calls[0][0] as prompts.PromptObject[])[2];
    expect(await question.validate!(password, {}, question)).toBe(expected);
    expect(fetch).toHaveBeenCalledTimes(expected === true ? 1 : 0);
  });

  test('the prompt rejects breached passwords without exposing the password or complete hash', async () => {
    const digest = crypto.createHash('sha1').update(input.password).digest('hex').toUpperCase();
    jest.mocked(fetch).mockResolvedValueOnce(new Response(`${digest.slice(5)}:42\r\n`));
    jest.mocked(prompts).mockResolvedValueOnce(input);
    await readAdminInput();
    const question = (jest.mocked(prompts).mock.calls[0][0] as prompts.PromptObject[])[2];
    expect(await question.validate!(input.password, {}, question)).toBe('This password appears in known data breaches. Please choose another password');
    expect(fetch).toHaveBeenCalledWith(`https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`, expect.objectContaining({ headers: { 'Add-Padding': 'true' }, signal: expect.any(AbortSignal) }));
    expect(JSON.stringify(jest.mocked(fetch).mock.calls)).not.toContain(input.password);
    expect(JSON.stringify(jest.mocked(fetch).mock.calls)).not.toContain(digest);
  });

  test('direct initialization also refuses breached passwords without creating keys or accounts', async () => {
    const digest = crypto.createHash('sha1').update(input.password).digest('hex').toUpperCase();
    jest.mocked(fetch).mockResolvedValueOnce(new Response(`${digest.slice(5)}:2`));
    const random = jest.spyOn(crypto, 'randomBytes');
    await expect(initializeAdmin(db, input)).rejects.toThrow('known data breaches');
    expect(random).not.toHaveBeenCalled();
    expect(ensureInstanceSalt).not.toHaveBeenCalled();
    expect(await db.findAllUsers()).toEqual([]);
  });

  test('ignores padding entries with a zero count and unmatched hash suffixes', async () => {
    const digest = crypto.createHash('sha1').update(input.password).digest('hex').toUpperCase();
    jest.mocked(fetch).mockResolvedValueOnce(new Response(`${digest.slice(5)}:0\r\nOTHERHASH:42`));
    await initializeAdmin(db, input);
    expect(await db.findAllUsers()).toHaveLength(1);
    expect(console.warn).not.toHaveBeenCalled();
  });

  test.each(['network', 'http', 'body'] as const)('allows initialization with a sanitized warning when the breach check fails (%s)', async (failure) => {
    if (failure === 'network') jest.mocked(fetch).mockRejectedValueOnce(new Error(input.password));
    if (failure === 'http') jest.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    if (failure === 'body') jest.mocked(fetch).mockResolvedValueOnce({ ok: true, text: jest.fn().mockRejectedValue(new Error(input.password)) } as unknown as Response);
    await initializeAdmin(db, input);
    expect(await db.findAllUsers()).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith('Warning: The breached-password check was unavailable. The password was allowed anyway.');
    expect(JSON.stringify(jest.mocked(console.warn).mock.calls)).not.toContain(input.password);
  });
});
