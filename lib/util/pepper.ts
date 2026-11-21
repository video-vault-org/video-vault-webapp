import { randomBytes, randomUUID } from 'node:crypto';
import { link, readFile, unlink, writeFile } from 'node:fs/promises';

/** Reads the stored hex text without changing its spelling, since that text participates in key derivation. */
async function readPepper(filePath: string): Promise<string> {
  const pepper = await readFile(filePath, 'utf8');
  if (pepper.length !== 64 || !/^[0-9a-f]{64}$/i.test(pepper)) throw new Error('Pepper file must contain exactly 64 hexadecimal characters');
  return pepper;
}

/**
 * Returns the existing ./.pepper, or creates 32 cryptographically random bytes encoded as 64 hex characters.
 * A completed temporary file is published atomically with a hard link, without overwriting another startup's pepper.
 * New files use permissions 0600. Invalid/unreadable existing files cause an error rather than changing the pepper.
 */
async function ensurePepper({ filePath = './.pepper' }: { filePath?: string } = {}): Promise<string> {
  try {
    return await readPepper(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }
  const pepper = randomBytes(32).toString('hex');
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, pepper, { flag: 'wx', mode: 0o600 });
    try {
      await link(temporaryPath, filePath);
      return pepper;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
      return await readPepper(filePath);
    }
  } finally {
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export { ensurePepper };
