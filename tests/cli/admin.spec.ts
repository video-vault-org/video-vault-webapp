import { argon2id, hash } from 'argon2';
import crypto, { webcrypto } from 'node:crypto';
import prompts from 'prompts';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { initializeAdmin, readAdminInput } from '@/cli/admin';
import { verifyPassword } from '@/util/password';
import { ensurePepper } from '@/util/pepper';
import { DatabaseConflictError } from '@/db/errors/DatabaseConflictError';

jest.mock('prompts', () => jest.fn());
jest.mock('@/util/pepper', () => ({ ensurePepper: jest.fn() }));
const pepper = 'ab'.repeat(32);

const input = { username: 'alice', displayName: 'Alice', password: 'p\u00e4ssword-\ud83d\udd10' };
const uuid = '5eaef793-3886-49b1-8947-5216b6746fb3';
const existing = { userId: uuid, username: 'existing', displayName: 'Existing', loginHash: 'unused', passwordKeySalt: 'unused', userKey: 'unused', admin: false, editor: false, moderator: false };

describe('interactive admin initialization', () => {
  jest.setTimeout(30_000);
  let db: InMemoryDatabaseAdapter;
  beforeEach(() => {
    db = new InMemoryDatabaseAdapter();
    jest.mocked(prompts).mockReset();
    jest.mocked(ensurePepper).mockReset().mockResolvedValue(pepper);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('asks for three attributes, masks the password and never prompts for pepper', async () => {
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
    expect(saved).not.toHaveProperty('pepper');
    expect(JSON.stringify(saved)).not.toContain(input.password);
    expect(JSON.stringify(saved)).not.toContain(pepper);
    expect(saved.passwordKeySalt).toBe(salt.toString('base64'));
    expect(Buffer.from(saved.passwordKeySalt, 'base64')).toHaveLength(32);
    const wrappedKeys = Buffer.from(saved.userKey, 'base64');
    expect(wrappedKeys).toHaveLength(80);
    const wrappedAesKey = wrappedKeys.subarray(0, 40);
    const wrappedHmacKey = wrappedKeys.subarray(40);
    expect(wrappedAesKey).not.toEqual(wrappedHmacKey);

    const loginHash = await hash(input.password, { salt: Buffer.from(pepper + input.username, 'utf8'), type: argon2id, version: 0x13, memoryCost: 19456, timeCost: 2, parallelism: 1, hashLength: 32, raw: true });
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
    { ...input, pepper: 'supplied-pepper' },
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

  test('does not create the admin if reading the pepper fails', async () => {
    const error = new Error('Pepper is unreadable');
    jest.mocked(ensurePepper).mockRejectedValueOnce(error);
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
});
