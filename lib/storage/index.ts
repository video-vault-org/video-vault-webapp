import { StorageConfig } from '@/storage/types/StorageConfig';
import { LocalStorageAdapter } from '@/storage/adapters/LocalStorageAdapter';
import { StorageAdapter } from '@/storage/types/StorageAdapter';
import { S3StorageAdapter } from '@/storage/adapters/S3StorageAdapter';

let storage: StorageAdapter | null = null;

const saveConfig = async function (config: StorageConfig) {
  const configBuffer = Buffer.from(JSON.stringify(config), 'utf8');
  await new LocalStorageAdapter({ basePath: './conf' }).save('storage.json', configBuffer);
  resetStorage();
};

const loadConfig = async function (): Promise<StorageConfig | null> {
  const configBuffer = await new LocalStorageAdapter({ basePath: './conf' }).read('storage.json');
  if (!configBuffer) {
    return null;
  }
  return JSON.parse(configBuffer.toString('utf8'));
};

const loadStorage = async function (): Promise<StorageAdapter> {
  if (storage) {
    return storage;
  }

  const configBuffer = await new LocalStorageAdapter({ basePath: './conf' }).read('storage.json');
  const config: StorageConfig = JSON.parse(configBuffer?.toString('utf8') ?? '{}');

  if (config.type === 's3') {
    storage = new S3StorageAdapter(config.conf);
  } else {
    storage = new LocalStorageAdapter(config.conf);
  }

  return storage;
};

const resetStorage = function () {
  storage = null;
};

export { saveConfig, loadConfig, loadStorage, resetStorage };
