import { StorageConfig } from '@/storage/config/StorageConfig';
import { LocalStorageAdapter } from '@/storage/adapters/LocalStorageAdapter';
import { StorageAdapter } from '@/storage/adapters/StorageAdapter';
import { S3StorageAdapter } from '@/storage/adapters/S3StorageAdapter';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';
import { StorageWrapper } from '@/storage/StorageWrapper';

let storage: StorageWrapper | null = null;

const saveConfig = async function (config: StorageConfig) {
  const configBuffer = Buffer.from(JSON.stringify(config, null, 4), 'utf8');
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

const loadStorage = async function (): Promise<StorageWrapper> {
  if (storage) {
    return storage;
  }

  const config = await loadConfig();
  if (storage) {
    return storage;
  }

  let adapter: StorageAdapter;
  if (config?.type === 's3') {
    adapter = new S3StorageAdapter(config.conf);
  } else if (config?.type === 'local') {
    adapter = new LocalStorageAdapter(config.conf);
  } else {
    adapter = new InMemoryStorageAdapter();
  }

  storage = new StorageWrapper(adapter);
  return storage;
};

const resetStorage = function () {
  storage = null;
};

export { saveConfig, loadConfig, loadStorage, resetStorage };
