import { scryptHashing } from '@/auth/hashing/scryptHashing';
import crypto from 'crypto';

let mockRandom: boolean | undefined;
const mockedSalt = Buffer.from(new Uint8Array(16));

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    randomBytes(length: number): Buffer {
      return mockRandom ? Buffer.from(new Uint8Array(length)) : actual.randomBytes(length);
    }
  };
});

describe('scryptHashing', (): void => {
  test(`version returns 'scrypt'.`, async (): Promise<void> => {
    expect(scryptHashing.algorithm).toBe('scrypt');
  });

  test('hashPassword hashes Password correctly (mocked random).', async (): Promise<void> => {
    mockRandom = true;
    const password = 'password123';

    const [salt, hash] = await scryptHashing.hashPassword(password);

    expect(salt).toBe(mockedSalt.toString('base64'));
    expect(hash).toBe(crypto.scryptSync(password, mockedSalt, 32, { N: 131_072, r: 8, p: 1, maxmem: 168 * 131_072 * 8 }).toString('base64'));
  });

  test('hashPassword hashes Password correctly (true random, hash and check).', async (): Promise<void> => {
    mockRandom = false;
    const password = 'password123';

    const [salt, hash] = await scryptHashing.hashPassword(password);
    const valid = await scryptHashing.checkPassword(password, salt, hash);

    expect(valid).toBe(true);
  });

  test('checkPassword returns true for valid password.', async (): Promise<void> => {
    const password = 'password123';
    // noinspection SpellCheckingInspection
    const salt = 'AAAAAAAAAAAAAAAAAAAAAA==';
    // noinspection SpellCheckingInspection
    const hash = 'SDdwY07PBISVQnAnHnkj8ZgVZYASnvjv27ZF6jivbT0=';

    const valid = await scryptHashing.checkPassword(password, salt, hash);

    expect(valid).toBe(true);
  });

  test('checkPassword returns false for invalid password.', async (): Promise<void> => {
    const password = 'invalid';
    // noinspection SpellCheckingInspection
    const salt = 'AAAAAAAAAAAAAAAAAAAAAA==';
    // noinspection SpellCheckingInspection
    const hash = 'SDdwY07PBISVQnAnHnkj8ZgVZYASnvjv27ZF6jivbT0=';

    const valid = await scryptHashing.checkPassword(password, salt, hash);

    expect(valid).toBe(false);
  });
});
