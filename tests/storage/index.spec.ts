import fs from 'fs/promises';
import mockFS from 'mock-fs';
import { saveConfig, loadConfig, loadStorage, resetStorage } from '@/storage';
import { exists } from '#/util';
import { LocalStorageAdapter } from '@/storage/adapters/LocalStorageAdapter';
import { StorageConfig } from '@/storage/types/StorageConfig';
import { S3StorageAdapter } from '@/storage/adapters/S3StorageAdapter';
import { S3Client } from '@aws-sdk/client-s3';

describe('storage', () => {
  afterEach(() => {
    mockFS.restore();
    resetStorage();
  });

  test('saveConfig saves config.', async () => {
    mockFS({});

    await saveConfig({ type: 'local', conf: { basePath: './files' } });

    expect(await exists('./conf/storage.json')).toBe(true);
    expect(JSON.parse((await fs.readFile('./conf/storage.json'))?.toString('utf8'))).toEqual({ type: 'local', conf: { basePath: './files' } });
  });

  test('loadConfig loads config.', async () => {
    mockFS({ './conf': { 'storage.json': JSON.stringify({ type: 'local' }) } });

    const config = await loadConfig();

    expect(config).toEqual({ type: 'local' });
  });

  test('loadConfig returns null.', async () => {
    mockFS();

    const config = await loadConfig();

    expect(config).toBeNull();
  });

  test('loadStorage loads local storage correctly', async () => {
    mockFS({ './conf': { 'storage.json': JSON.stringify({ type: 'local', conf: { basePath: './files' } }) } });

    const storage = await loadStorage();

    expect(storage).toBeInstanceOf(LocalStorageAdapter);
    expect((storage as LocalStorageAdapter).getBasePath()).toEqual('./files');
  });

  test('loadStorage loads s3 storage correctly', async () => {
    const config: StorageConfig = { type: 's3', conf: { region: 'local', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'bucket' } };
    mockFS({ './conf': { 'storage.json': JSON.stringify(config) } });

    const storage = await loadStorage();

    expect(storage).toBeInstanceOf(S3StorageAdapter);
    expect((storage as S3StorageAdapter).getConf()[0]).toBeInstanceOf(S3Client);
    expect((await (storage as S3StorageAdapter).getConf()[0].config.credentials()).accessKeyId).toEqual('key');
    expect((storage as S3StorageAdapter).getConf()[1]).toEqual('bucket');
  });
});
