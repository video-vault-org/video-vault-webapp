import { scryptSync } from 'node:crypto';
import { hashPassword, verifyPassword } from '@/util/password';

describe('password hashing', () => {
  const password = Buffer.from('client-derived-login-hash').toString('base64');
  let stored: string;

  beforeAll(async () => {
    stored = await hashPassword(password);
  });

  test('hashPassword stores scrypt parameters, a random salt and the derived hash', async () => {
    const [, algorithm, parameters, salt, hash] = stored.split('$');
    expect(algorithm).toBe('scrypt');
    expect(parameters).toBe('ln=15,r=8,p=3');
    expect(Buffer.from(salt, 'base64')).toHaveLength(16);
    const independentlyDerived = scryptSync(password, Buffer.from(salt, 'base64'), 32, { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
    expect(Buffer.from(hash, 'base64')).toEqual(independentlyDerived);
    expect(stored).not.toContain(password);
    expect(await hashPassword(password)).not.toBe(stored);
  });

  test('verifyPassword accepts the matching Base64 password and rejects another password', async () => {
    await expect(verifyPassword(password, stored)).resolves.toBe(true);
    await expect(verifyPassword(Buffer.from('wrong').toString('base64'), stored)).resolves.toBe(false);
  });

  test.each(['', 'plain-text', '$scrypt$', '$scrypt$ln=99,r=8,p=3$c2FsdA==$aGFzaA==', '$scrypt$ln=15,r=8,p=3$invalid$invalid'])('verifyPassword rejects malformed or unsupported storage strings: %s', async (value) => {
    await expect(verifyPassword(password, value)).resolves.toBe(false);
  });

  test('verifyPassword rejects non-canonical Base64 and extra fields', async () => {
    const parts = stored.split('$');
    parts[3] += '!';
    await expect(verifyPassword(password, parts.join('$'))).resolves.toBe(false);
    await expect(verifyPassword(password, `${stored}$extra`)).resolves.toBe(false);
  });
});
