import { readFile, writeFile } from 'node:fs/promises';
import mockFS from 'mock-fs';
import { loadConfig, loadStorage, resetStorage, saveConfig } from '@/storage';
import { StorageWrapper } from '@/storage/StorageWrapper';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';
import { LocalStorageAdapter } from '@/storage/adapters/LocalStorageAdapter';
import { S3StorageAdapter } from '@/storage/adapters/S3StorageAdapter';
import { StorageConfig } from '@/storage/config/StorageConfig';

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
  ] satisfies [StorageConfig, typeof InMemoryStorageAdapter | typeof LocalStorageAdapter | typeof S3StorageAdapter][])('loads configuration and wraps the matching adapter for %j', async (config, expectedAdapter) => {
    mockFS({ './conf': { 'storage.json': JSON.stringify(config) } });

    expect(await loadConfig()).toEqual(config);
    const storage = await loadStorage();
    const adapter = storage['storageAdapter'];
    try {
      expect(storage).toBeInstanceOf(StorageWrapper);
      expect(adapter).toBeInstanceOf(expectedAdapter);
    } finally {
      if (adapter instanceof S3StorageAdapter) {
        adapter.getConf()[0].destroy();
      }
    }
  });

  test('loadConfig returns null when the configuration is missing', async () => {
    mockFS({ './conf': {} });

    expect(await loadConfig()).toBeNull();
  });

  test('loadStorage wraps an in-memory adapter when the configuration is missing', async () => {
    mockFS({ './conf': {} });

    const storage = await loadStorage();

    expect(storage).toBeInstanceOf(StorageWrapper);
    expect(storage['storageAdapter']).toBeInstanceOf(InMemoryStorageAdapter);
  });

  test('loadConfig and loadStorage report malformed JSON', async () => {
    mockFS({ './conf': { 'storage.json': '{' } });

    await expect(loadConfig()).rejects.toThrow(SyntaxError);
    await expect(loadStorage()).rejects.toThrow(SyntaxError);
  });

  test('loadStorage writes media through the wrapper to the configured local directory', async () => {
    mockFS({ './conf': { 'storage.json': JSON.stringify(localConfig) } });

    const storage = await loadStorage();

    const bytes = Buffer.from([0, 255]);
    await storage.saveVideoFile('clip', bytes);

    expect(await readFile('./videos/clip.video')).toEqual(bytes);
  });

  test('loadStorage builds an S3 adapter from its configuration', async () => {
    mockFS({ './conf': { 'storage.json': JSON.stringify(s3Config) } });

    const storage = await loadStorage();
    const adapter = storage['storageAdapter'] as S3StorageAdapter;
    const [client, bucket] = adapter.getConf();
    try {
      expect(bucket).toBe(s3Config.conf.bucket);
      expect(await client.config.region()).toBe(s3Config.conf.region);
    } finally {
      client.destroy();
    }
  });

  test('loadStorage reuses its cached wrapper until resetStorage is called', async () => {
    mockFS({ './conf': { 'storage.json': JSON.stringify(localConfig) } });
    const [original, concurrent] = await Promise.all([loadStorage(), loadStorage()]);
    expect(concurrent).toBe(original);
    await writeFile(configPath, JSON.stringify({ type: 'local', conf: { basePath: './other' } }));

    expect(await loadStorage()).toBe(original);

    resetStorage();
    const reloaded = await loadStorage();
    expect(reloaded).not.toBe(original);
    const bytes = Buffer.from([1]);
    await reloaded.saveVideoFile('clip', bytes);
    expect(await readFile('./other/clip.video')).toEqual(bytes);
  });

  test('saveConfig replaces the cached wrapper with one using the new configuration', async () => {
    mockFS({ './conf': { 'storage.json': JSON.stringify(localConfig) } });
    const original = await loadStorage();

    await saveConfig({ type: 'local', conf: { basePath: './new' } });

    const reloaded = await loadStorage();
    expect(reloaded).not.toBe(original);
    const bytes = Buffer.from([2]);
    await reloaded.saveThumbnailFile('clip', bytes);
    expect(await readFile('./new/clip.thumbnail')).toEqual(bytes);
  });
});
