import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, loadStorage, resetStorage, saveConfig } from '@/storage';
import { StorageWrapper } from '@/storage/StorageWrapper';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';
import { LocalStorageAdapter } from '@/storage/adapters/LocalStorageAdapter';
import { S3StorageAdapter } from '@/storage/adapters/S3StorageAdapter';
import { StorageConfig } from '@/storage/config/StorageConfig';

describe('storage', () => {
  const configPath = './conf/storage.json';
  const originalDirectory = process.cwd();
  let directory: string;
  const localConfig: StorageConfig = { type: 'local', conf: { basePath: './videos' } };
  const s3Config: StorageConfig = {
    type: 's3',
    conf: { region: 'us-east-1', bucket: 'video-vault', accessKeyId: 'test-user', secretAccessKey: 'test-password' }
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'video-vault-storage-config-'));
    // The module intentionally uses ./conf and ./tmp; isolate that working directory for each test.
    process.chdir(directory);
  });

  afterEach(async () => {
    resetStorage();
    process.chdir(originalDirectory);
    await rm(directory, { recursive: true, force: true });
  });

  async function configure(config: StorageConfig): Promise<void> {
    await mkdir('./conf');
    await writeFile(configPath, JSON.stringify(config));
  }

  test('saveConfig creates the configuration directory and writes JSON', async () => {
    await saveConfig(localConfig);

    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(localConfig);
  });

  test.each([
    [{ type: 'in-memory' }, InMemoryStorageAdapter],
    [localConfig, LocalStorageAdapter],
    [s3Config, S3StorageAdapter]
  ] satisfies [StorageConfig, typeof InMemoryStorageAdapter | typeof LocalStorageAdapter | typeof S3StorageAdapter][])('loads configuration and wraps the matching adapter for %j', async (config, expectedAdapter) => {
    await configure(config);

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
    await mkdir('./conf');

    expect(await loadConfig()).toBeNull();
  });

  test('loadConfig propagates filesystem errors other than a missing file', async () => {
    await writeFile('./conf', 'not a directory');

    await expect(loadConfig()).rejects.toMatchObject({ code: 'ENOTDIR' });
  });

  test('loadStorage wraps an in-memory adapter when the configuration is missing', async () => {
    await mkdir('./conf');

    const storage = await loadStorage();

    expect(storage).toBeInstanceOf(StorageWrapper);
    expect(storage['storageAdapter']).toBeInstanceOf(InMemoryStorageAdapter);
  });

  test('loadConfig and loadStorage report malformed JSON', async () => {
    await mkdir('./conf');
    await writeFile(configPath, '{');

    await expect(loadConfig()).rejects.toThrow(SyntaxError);
    await expect(loadStorage()).rejects.toThrow(SyntaxError);
  });

  test('loadStorage writes media through the wrapper to the configured local directory', async () => {
    await configure(localConfig);
    await mkdir('./tmp');

    const storage = await loadStorage();

    const bytes = Buffer.from([0, 255]);
    await writeFile('./tmp/clip.video', bytes);
    await storage.saveVideoFile({ videoId: 'clip' });

    expect(await readFile('./videos/clip.video')).toEqual(bytes);
  });

  test('loadStorage builds an S3 adapter from its configuration', async () => {
    await configure(s3Config);

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
    await configure(localConfig);
    await mkdir('./tmp');
    const [original, concurrent] = await Promise.all([loadStorage(), loadStorage()]);
    expect(concurrent).toBe(original);
    await writeFile(configPath, JSON.stringify({ type: 'local', conf: { basePath: './other' } }));

    expect(await loadStorage()).toBe(original);

    resetStorage();
    const reloaded = await loadStorage();
    expect(reloaded).not.toBe(original);
    const bytes = Buffer.from([1]);
    await writeFile('./tmp/clip.video', bytes);
    await reloaded.saveVideoFile({ videoId: 'clip' });
    expect(await readFile('./other/clip.video')).toEqual(bytes);
  });

  test('saveConfig replaces the cached wrapper with one using the new configuration', async () => {
    await configure(localConfig);
    await mkdir('./tmp');
    const original = await loadStorage();

    await saveConfig({ type: 'local', conf: { basePath: './new' } });

    const reloaded = await loadStorage();
    expect(reloaded).not.toBe(original);
    const bytes = Buffer.from([2]);
    await writeFile('./tmp/clip.thumbnail', bytes);
    await reloaded.saveThumbnailFile({ videoId: 'clip' });
    expect(await readFile('./new/clip.thumbnail')).toEqual(bytes);
  });
});
