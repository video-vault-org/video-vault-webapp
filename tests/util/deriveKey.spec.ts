import { deriveKey } from '@/util/deriveKey';

describe('deriveKey', () => {
  test('matches an Argon2 reference-binding result with the explicit OWASP profile and UTF-8 input', async () => {
    // Argon2id v19, m=19456 KiB, t=2, p=1, 32-byte output.
    const key = await deriveKey('p\u00e4ssword-\ud83d\udd10', 'application-salt-alice');
    expect(key).toHaveLength(32);
    expect(key.toString('hex')).toBe('b01b12ad711e5c80eeea22843f319b700779e0355280990062296352a31906e5');
  });

  test('uses raw salt bytes and does not mutate the salt', async () => {
    const salt = Buffer.from('test-salt', 'utf8');
    expect(await deriveKey('password', salt)).toEqual(await deriveKey('password', 'test-salt'));
    expect(salt.toString('utf8')).toBe('test-salt');
  });

  test('distinguishes passwords and salts', async () => {
    const first = await deriveKey('password', 'test-salt');
    expect(await deriveKey('other', 'test-salt')).not.toEqual(first);
    expect(await deriveKey('password', 'other-salt')).not.toEqual(first);
  });

  test.each(['', 'short', Buffer.alloc(7)])('rejects salts shorter than eight bytes', async (salt) => {
    await expect(deriveKey('password', salt)).rejects.toThrow('at least 8 bytes');
  });

  test('measures the salt in UTF-8 bytes, not characters', async () => {
    expect(await deriveKey('password', '\u00e4\u00e4\u00e4\u00e4')).toHaveLength(32);
  });
});
