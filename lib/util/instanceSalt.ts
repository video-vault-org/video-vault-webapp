import { randomBytes, randomUUID } from 'node:crypto';
import { link, readFile, unlink, writeFile } from 'node:fs/promises';

/** Reads the stored hex text without changing its spelling, since that text participates in key derivation. */
async function readInstanceSalt(filePath: string): Promise<string> {
  const instanceSalt = await readFile(filePath, 'utf8');
  if (instanceSalt.length !== 64 || !/^[0-9a-f]{64}$/i.test(instanceSalt)) throw new Error('Instance salt file must contain exactly 64 hexadecimal characters');
  return instanceSalt;
}

/**
 * Returns the existing ./.salt, or creates 32 cryptographically random bytes encoded as 64 hex characters.
 * A completed temporary file is published atomically with a hard link, without overwriting another startup's instance salt.
 * New files use permissions 0600. Invalid/unreadable existing files cause an error rather than changing the instance salt.
 */
async function ensureInstanceSalt({ filePath = './.salt' }: { filePath?: string } = {}): Promise<string> {
  try {
    return await readInstanceSalt(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }
  const instanceSalt = randomBytes(32).toString('hex');
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, instanceSalt, { flag: 'wx', mode: 0o600 });
    try {
      await link(temporaryPath, filePath);
      return instanceSalt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
      return await readInstanceSalt(filePath);
    }
  } finally {
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export { ensureInstanceSalt };
