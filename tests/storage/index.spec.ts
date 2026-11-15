import { readFile, writeFile } from 'node:fs/promises';
import mockFS from 'mock-fs';
import { loadConfig, loadStorage, resetStorage, saveConfig } from '@/storage';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';
import { LocalStorageAdapter } from '@/storage/adapters/LocalStorageAdapter';
import { S3StorageAdapter } from '@/storage/adapters/S3StorageAdapter';
import { StorageConfig } from '@/storage/types/StorageConfig';

describe('storage', () => {
  const configPath = './conf/storage.json';
  const localConfig: StorageConfig = { type: 'local', conf: { basePath: './videos' } };
  const s3Config: StorageConfig = {
    type: 's3',
    conf: { region: 'us-east-1', bucket: 'video-vault', accessKeyId: 'test-user', secretAccessKey: 'test-password' }
  };

  afterEach(() => {
    resetStorage();
    mockFS.restore();
  });

  test('saveConfig creates the configuration directory and writes JSON', async () => {
    mockFS({});

    await saveConfig(localConfig);

    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(localConfig);
  });

  test.each([
    [{ type: 'in-memory' }, InMemoryStorageAdapter],
    [localConfig, LocalStorageAdapter],
    [s3Config, S3StorageAdapter]
  ] satisfies [StorageConfig, typeof InMemoryStorageAdapter | typeof LocalStorageAdapter | typeof S3StorageAdapter][])(
    'loads configuration and selects the matching adapter for %j',
    async (config, expectedAdapter) => {
      mockFS({ './conf': { 'storage.json': JSON.stringify(config) } });

      expect(await loadConfig()).toEqual(config);
      const storage = await loadStorage();
      try {
        expect(storage).toBeInstanceOf(expectedAdapter);
      } finally {
        if (storage instanceof S3StorageAdapter) {
          storage.getConf()[0].destroy();
        }
      }
    }
  );

  test('loadConfig returns null when the configuration is missing', async () => {
    mockFS({ './conf': {} });

    expect(await loadConfig()).toBeNull();
  });

  test('loadConfig and loadStorage report malformed JSON', async () => {
    mockFS({ './conf': { 'storage.json': '{' } });

    await expect(loadConfig()).rejects.toThrow(SyntaxError);
    await expect(loadStorage()).rejects.toThrow(SyntaxError);
  });

  test('loadStorage builds a local adapter from its configuration', async () => {
    mockFS({ './conf': { 'storage.json': JSON.stringify(localConfig) } });

    const storage = await loadStorage();

    expect(storage).toBeInstanceOf(LocalStorageAdapter);
    expect((storage as LocalStorageAdapter).getBasePath()).toBe(localConfig.conf.basePath);
  });

  test('loadStorage builds an S3 adapter from its configuration', async () => {
    mockFS({ './conf': { 'storage.json': JSON.stringify(s3Config) } });

    const storage = await loadStorage();
    expect(storage).toBeInstanceOf(S3StorageAdapter);
    const [client, bucket] = (storage as S3StorageAdapter).getConf();
    try {
      expect(bucket).toBe(s3Config.conf.bucket);
      expect(await client.config.region()).toBe(s3Config.conf.region);
    } finally {
      client.destroy();
    }
  });

  test('loadStorage reuses its cached instance until resetStorage is called', async () => {
    mockFS({ './conf': { 'storage.json': JSON.stringify(localConfig) } });
    const original = await loadStorage();
    await writeFile(configPath, JSON.stringify({ type: 'local', conf: { basePath: './other' } }));

    expect(await loadStorage()).toBe(original);

    resetStorage();
    const reloaded = await loadStorage();
    expect(reloaded).not.toBe(original);
    expect((reloaded as LocalStorageAdapter).getBasePath()).toBe('./other');
  });

  test('saveConfig replaces the cached adapter with one using the new configuration', async () => {
    mockFS({ './conf': { 'storage.json': JSON.stringify(localConfig) } });
    const original = await loadStorage();

    await saveConfig({ type: 'local', conf: { basePath: './new' } });

    const reloaded = await loadStorage();
    expect(reloaded).not.toBe(original);
    expect((reloaded as LocalStorageAdapter).getBasePath()).toBe('./new');
  });
});
