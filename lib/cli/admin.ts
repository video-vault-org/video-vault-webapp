import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import prompts from 'prompts';
import { z } from 'zod';
import { DatabaseAdapter } from '@/db/adapters/DatabaseAdapter';
import { UserService } from '@/service/UserService';
import { deriveKey } from '@/util/deriveKey';
import { ensurePepper } from '@/util/pepper';

const value = z.string().min(1).max(4096);
const inputSchema = z.object({ username: value.min(3), displayName: value, password: value }).strict();

/**
 * Prompts once for username (3–4096 characters), display name and password.
 * Password is rendered as asterisks. Pepper is loaded from ./.pepper during initialization.
 * @throws If cancelled or the answers are invalid.
 */
async function readAdminInput(): Promise<{ username: string; displayName: string; password: string }> {
  const validate = (answer: string) => (answer.length >= 1 && answer.length <= 4096 ? true : 'Please enter 1 to 4096 characters');
  const answers = await prompts(
    [
      { type: 'text', name: 'username', message: 'Username', validate: (answer: string) => (answer.length >= 3 && answer.length <= 4096) || 'Please enter 3 to 4096 characters' },
      { type: 'text', name: 'displayName', message: 'Display name', validate },
      { type: 'password', name: 'password', message: 'Password', validate }
    ],
    {
      onCancel: () => {
        throw new Error('Admin initialization cancelled');
      }
    }
  );
  return inputSchema.parse(answers);
}

/**
 * Creates the first admin, refusing to run if any admin already exists.
 * A UUID v4 identifies the user. LoginHash is Argon2id(password, pepper + username), producing 32 raw bytes.
 * Both Argon2id derivations use v19, 19456 KiB, 2 passes and parallelism 1 (OWASP minimum profile).
 * A separate passwordKey uses a random 32-byte passwordKeySalt.
 * A fresh random 32-byte user key is wrapped with passwordKey using RFC 3394 AES-256-KW without padding.
 * LoginHash, passwordKeySalt and the wrapped userKey are Base64-encoded; UserService additionally hashes loginHash with scrypt.
 * Password is never stored. Pepper is read from ./.pepper (created if absent). Temporary secret buffers are cleared after use.
 * The initial user has only the admin role.
 * @param db An opened and initialized database adapter.
 * @param input The entered username, displayName and password; IDs, keys and roles cannot be supplied.
 * @throws If validation, key derivation or the database operation fails, or an admin already exists.
 */
async function initializeAdmin(db: DatabaseAdapter, input: unknown): Promise<void> {
  const { username, displayName, password } = inputSchema.parse(input);
  if ((await db.findAllUsers()).some((existing) => existing.admin)) throw new Error('An admin already exists');
  const userId = randomUUID();
  if (await db.findOneUserByUserId({ userId })) throw new Error('User ID already exists');
  const pepper = await ensurePepper();
  const passwordKeySalt = randomBytes(32);
  const loginHash = await deriveKey(password, pepper + username);
  let passwordKey: Buffer | undefined;
  let key: Buffer | undefined;
  try {
    passwordKey = await deriveKey(password, passwordKeySalt);
    key = randomBytes(32);
    const cipher = createCipheriv('id-aes256-wrap', passwordKey, Buffer.alloc(8, 0xa6));
    const userKey = Buffer.concat([cipher.update(key), cipher.final()]);
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
    key?.fill(0);
  }
}

export { readAdminInput, initializeAdmin };
