import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import prompts from 'prompts';
import { z } from 'zod';
import { DatabaseAdapter } from '@/db/adapters/DatabaseAdapter';
import { UserService } from '@/service/UserService';
import { deriveKey } from '@/util/deriveKey';
import { ensureInstanceSalt } from '@/util/instanceSalt';

/** Matches the browser policy, including Unicode character categories and the input size limit. */
const validatePassword = function (password: string): true | string {
  if (Array.from(password).length < 12 || password.length > 4096) return 'Please enter 12 to 4096 characters';
  if ([/\p{Lu}/u, /\p{Ll}/u, /\p{N}/u, /[^\p{L}\p{N}\s]/u].filter((pattern) => pattern.test(password)).length < 3) {
    return 'Please use at least three character types: uppercase letters, lowercase letters, numbers, special characters';
  }
  return true;
};

/** Checks only the SHA-1 prefix with HIBP; the full hash and password remain local. */
const checkPasswordBreaches = async function (password: string): Promise<true | string> {
  const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Password check unavailable');
    const breached = (await response.text()).split(/\r?\n/).some((line) => {
      const [suffix, count] = line.split(':');
      return suffix === digest.slice(5) && Number(count) > 0;
    });
    return breached ? 'This password appears in known data breaches. Please choose another password' : true;
  } catch {
    console.warn('Warning: The breached-password check was unavailable. The password was allowed anyway.');
    return true;
  }
};

const value = z.string().min(1).max(4096);
const inputSchema = z.object({ username: value.min(3), displayName: value, password: value.refine((password) => validatePassword(password) === true, 'Password must contain 12 to 4096 characters and at least three character types') }).strict();

/**
 * Prompts once for username (3–4096 characters), display name and password.
 * Password is rendered as asterisks and checked against the browser strength and breached-password policies. The instance salt is loaded from ./.salt during initialization.
 * @throws If cancelled or the answers are invalid.
 */
const readAdminInput = async function (): Promise<{ username: string; displayName: string; password: string }> {
  const validate = (answer: string) => (answer.length >= 1 && answer.length <= 4096 ? true : 'Please enter 1 to 4096 characters');

  const answers = await prompts(
    [
      { type: 'text', name: 'username', message: 'Username', validate: (answer: string) => (answer.length >= 3 && answer.length <= 4096) || 'Please enter 3 to 4096 characters' },
      { type: 'text', name: 'displayName', message: 'Display name', validate },
      { type: 'password', name: 'password', message: 'Password', validate: async (answer: string) => (validatePassword(answer) === true ? checkPasswordBreaches(answer) : validatePassword(answer)) }
    ],
    {
      onCancel: () => {
        throw new Error('Admin initialization cancelled');
      }
    }
  );
  return inputSchema.parse(answers);
};

/**
 * Creates the first admin, refusing to run if any admin already exists.
 * A UUID v4 identifies the user. LoginHash is Argon2id(password, instanceSalt + username), producing 32 raw bytes.
 * Both Argon2id derivations use v19, 19456 KiB, 2 passes and parallelism 1 (OWASP minimum profile).
 * A separate passwordKey uses a random 32-byte passwordKeySalt.
 * Independent random 32-byte AES and HMAC keys are each wrapped with passwordKey using RFC 3394 AES-256-KW without padding.
 * userKey is the Base64-encoded concatenation of the wrapped AES key followed by the wrapped HMAC key (40 bytes each).
 * LoginHash and passwordKeySalt are also Base64-encoded; UserService additionally hashes loginHash with scrypt.
 * Password is never stored. The instance salt is read from ./.salt (created if absent). Temporary secret buffers are cleared after use.
 * Enforces 12–4096 characters and three of four character categories; rejects known breached passwords.
 * Checks HIBP using only a five-hex SHA-1 prefix; unavailable checks allow initialization with a warning.
 * The initial user has only the admin role.
 * @param db An opened and initialized database adapter.
 * @param input The entered username, displayName and password; IDs, keys and roles cannot be supplied.
 * @throws If validation, key derivation or the database operation fails, or an admin already exists.
 */
const initializeAdmin = async function (db: DatabaseAdapter, input: unknown): Promise<void> {
  const { username, displayName, password } = inputSchema.parse(input);
  if ((await db.findAllUsers()).some((existing) => existing.admin)) throw new Error('An admin already exists');
  const passwordValidation = await checkPasswordBreaches(password);
  if (passwordValidation !== true) throw new Error(passwordValidation);
  const userId = randomUUID();
  if (await db.findOneUserByUserId({ userId })) throw new Error('User ID already exists');
  const instanceSalt = await ensureInstanceSalt();
  const passwordKeySalt = randomBytes(32);
  const loginHash = await deriveKey(password, instanceSalt + username);
  let passwordKey: Buffer | undefined;
  let aesKey: Buffer | undefined;
  let hmacKey: Buffer | undefined;
  try {
    passwordKey = await deriveKey(password, passwordKeySalt);
    aesKey = randomBytes(32);
    const aesCipher = createCipheriv('id-aes256-wrap', passwordKey, Buffer.alloc(8, 0xa6));
    const wrappedAesKey = Buffer.concat([aesCipher.update(aesKey), aesCipher.final()]);
    hmacKey = randomBytes(32);
    const hmacCipher = createCipheriv('id-aes256-wrap', passwordKey, Buffer.alloc(8, 0xa6));
    const wrappedHmacKey = Buffer.concat([hmacCipher.update(hmacKey), hmacCipher.final()]);
    const userKey = Buffer.concat([wrappedAesKey, wrappedHmacKey]);
    await new UserService(db).createUser({
      userId,
      username,
      displayName,
      loginHash: loginHash.toString('base64'),
      passwordKeySalt: passwordKeySalt.toString('base64'),
      userKey: userKey.toString('base64'),
      admin: true,
      editor: false,
      moderator: false
    });
  } finally {
    loginHash.fill(0);
    passwordKey?.fill(0);
    aesKey?.fill(0);
    hmacKey?.fill(0);
  }
};

export { readAdminInput, initializeAdmin };
