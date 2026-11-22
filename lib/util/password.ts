import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
// OWASP scrypt profile: N=2^15, r=8, p=3 (32 MiB).
const parameters = 'ln=15,r=8,p=3';
const options = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

const deriveKey = function (password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
};

/**
 * Hashes a password using scrypt and a fresh 16-byte salt.
 * The client's Base64 loginHash is treated as the password string, without decoding it.
 * @param password The client-supplied loginHash.
 * @returns A scrypt string containing the parameters, salt and derived hash.
 * @throws If deriving the password hash fails.
 */
const hashPassword = async function (password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await deriveKey(password, salt);
  return `$scrypt$${parameters}$${salt.toString('base64')}$${hash.toString('base64')}`;
};

/**
 * Verifies a password against a scrypt string using a constant-time hash comparison.
 * Rejects malformed strings and unsupported parameters without trusting their memory or CPU settings.
 * @param password The client-supplied loginHash.
 * @param stored The scrypt string saved in the database.
 * @returns Whether the password matches the stored hash.
 * @throws If deriving the password hash fails.
 */
const verifyPassword = async function (password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== '' || parts[1] !== 'scrypt' || parts[2] !== parameters) {
    return false;
  }
  const salt = Buffer.from(parts[3], 'base64');
  const expected = Buffer.from(parts[4], 'base64');
  if (salt.length !== 16 || expected.length !== 32 || salt.toString('base64') !== parts[3] || expected.toString('base64') !== parts[4]) {
    return false;
  }
  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, expected);
};

export { hashPassword, verifyPassword };
