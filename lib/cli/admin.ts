import { createCipheriv, pbkdf2, randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import prompts from 'prompts';
import { z } from 'zod';
import { DatabaseAdapter } from '@/db/adapters/DatabaseAdapter';
import { UserService } from '@/service/UserService';

const derive = promisify(pbkdf2);
const value = z.string().min(1).max(4096);
const inputSchema = z.object({ username: value, displayName: value, password: value, pepper: value }).strict();

/**
 * Prompts once for each attribute: username, display name, password and pepper.
 * Password is rendered as asterisks; pepper is visible. Cancelling rejects without returning partial credentials.
 * @returns The four entered attributes, preserving their exact text for key derivation.
 * @throws If the user cancels or the responses are invalid.
 */
async function readAdminInput(): Promise<{ username: string; displayName: string; password: string; pepper: string }> {
  const validate = (answer: string) => (answer.length >= 1 && answer.length <= 4096 ? true : 'Please enter 1 to 4096 characters');
  const answers = await prompts(
    [
      { type: 'text', name: 'username', message: 'Username', validate },
      { type: 'text', name: 'displayName', message: 'Display name', validate },
      { type: 'password', name: 'password', message: 'Password', validate },
      { type: 'text', name: 'pepper', message: 'Pepper', validate }
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
 * A UUID v4 identifies the user. LoginHash is PBKDF2-HMAC-SHA-256(password, pepper + username, 600000, 32).
 * A separate passwordKey uses the same PBKDF2 parameters with a random 32-byte passwordKeySalt.
 * A fresh random 32-byte user key is wrapped with passwordKey using RFC 3394 AES-256-KW without padding.
 * LoginHash, passwordKeySalt and the wrapped userKey are Base64-encoded; UserService additionally hashes loginHash with scrypt.
 * Password and pepper are never stored. Temporary secret buffers are cleared after use.
 * The initial user has only the admin role.
 * @param db An opened and initialized database adapter.
 * @param input The entered username, displayName, password and pepper; IDs, keys and roles cannot be supplied.
 * @throws If validation, key derivation or the database operation fails, or an admin already exists.
 */
async function initializeAdmin(db: DatabaseAdapter, input: unknown): Promise<void> {
  const { username, displayName, password, pepper } = inputSchema.parse(input);
  if ((await db.findAllUsers()).some((existing) => existing.admin)) throw new Error('An admin already exists');
  const userId = randomUUID();
  if (await db.findOneUserByUserId({ userId })) throw new Error('User ID already exists');
  const passwordKeySalt = randomBytes(32);
  const loginHash = await derive(password, pepper + username, 600_000, 32, 'sha256');
  let passwordKey: Buffer | undefined;
  let key: Buffer | undefined;
  try {
    passwordKey = await derive(password, passwordKeySalt, 600_000, 32, 'sha256');
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
