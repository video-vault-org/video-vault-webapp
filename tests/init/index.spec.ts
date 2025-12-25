import mockFS from 'mock-fs';
import { DatabaseConfig } from '@/db/types/DatabaseConfig';
import { StorageConfig } from '@/storage/types/StorageConfig';
import { FrontendConfig } from '@/frontend/types/FrontendConfig';
import { authorizeInit, initialize, isInit } from '@/init';
import { exists } from '#/util';
import fs from 'fs/promises';

let mocked_dbConfig: DatabaseConfig | null = null;
let mocked_storageConfig: StorageConfig | null = null;
let mocked_frontendConfig: FrontendConfig | null = null;

const keyHex = '6161616161616161616161616161616161616161';

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    randomBytes(size: number) {
      return Buffer.from('a'.repeat(size), 'utf8');
    }
  };
});

jest.mock('@/db', () => ({
  async loadConfig() {
    return mocked_dbConfig;
  }
}));

jest.mock('@/storage', () => ({
  async loadConfig() {
    return mocked_storageConfig;
  }
}));

jest.mock('@/frontend', () => ({
  async loadConfig() {
    return mocked_frontendConfig;
  }
}));

describe('init', () => {
  beforeEach(async () => {
    mockFS({});
  });

  afterEach(async () => {
    mockFS.restore();
    mocked_dbConfig = null;
    mocked_storageConfig = null;
    mocked_frontendConfig = null;
  });

  test('isInit returns false if all configs available.', async () => {
    mocked_dbConfig = { type: 'in-memory' };
    mocked_storageConfig = { type: 'local', conf: { basePath: '' } };
    mocked_frontendConfig = { videoMeta: [], title: '', logo: '' };

    const init = await isInit();

    expect(init).toBe(false);
  });

  test('isInit returns true if one config missing.', async () => {
    mocked_dbConfig = { type: 'in-memory' };
    mocked_frontendConfig = { videoMeta: [], title: '', logo: '' };

    const init = await isInit();

    expect(init).toBe(true);
  });

  test('initialize saves initKey correctly.', async () => {
    await initialize();

    expect(await exists('./initKey')).toBe(true);
    expect((await fs.readFile('./initKey')).toString('utf8')).toEqual(keyHex);
  });

  test('initialize saves no initKey if all configs available.', async () => {
    mocked_dbConfig = { type: 'in-memory' };
    mocked_storageConfig = { type: 'local', conf: { basePath: '' } };
    mocked_frontendConfig = { videoMeta: [], title: '', logo: '' };

    await initialize();

    expect(await exists('./initKey')).toBe(false);
  });

  test('authorizeInit returns false if no initKey file exists.', async () => {
    const authorized = await authorizeInit('');

    expect(authorized).toBe(false);
  });

  test('authorizeInit returns false if no key given.', async () => {
    mockFS({ './initKey': keyHex });

    const authorized = await authorizeInit(null);

    expect(authorized).toBe(false);
  });

  test('authorizeInit returns false if empty key given.', async () => {
    mockFS({ './initKey': keyHex });

    const authorized = await authorizeInit('');

    expect(authorized).toBe(false);
  });

  test('authorizeInit returns false if keys not match.', async () => {
    mockFS({ './initKey': keyHex });

    const authorized = await authorizeInit('0123456789012345678901234567890123456789');

    expect(authorized).toBe(false);
  });

  test('authorizeInit returns true if keys match.', async () => {
    mockFS({ './initKey': keyHex });

    const authorized = await authorizeInit(keyHex);

    expect(authorized).toBe(true);
  });
});
