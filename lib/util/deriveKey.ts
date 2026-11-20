import { argon2id, hash } from 'argon2';

const VERSION = 0x13; //Argon2 Version 1.3
const COST = 19 * 1024; //19MiB

/**
 * Derives 32 raw key bytes with Argon2id v19 and the OWASP minimum profile: 19456 KiB, 2 passes, 1 lane.
 * @param password The password, encoded as UTF-8 without normalization.
 * @param salt Raw salt bytes, or a string encoded as UTF-8. Must contain at least 8 bytes.
 * @returns The derived key bytes; callers must clear secret buffers after use.
 * @throws If the salt is too short or Argon2 fails.
 */
async function deriveKey(password: string, salt: string | Buffer): Promise<Buffer> {
  const bytes = Buffer.from(salt);
  if (bytes.length < 8) throw new RangeError('Argon2id salt must contain at least 8 bytes');
  return await hash(password, { type: argon2id, version: VERSION, memoryCost: COST, timeCost: 2, parallelism: 1, hashLength: 32, salt: bytes, raw: true });
}

export { deriveKey };
