import fs from 'fs/promises';
import { StorageConfig } from '@/storage/config/StorageConfig';
import { LocalStorageAdapter } from '@/storage/adapters/LocalStorageAdapter';
import { StorageAdapter } from '@/storage/adapters/StorageAdapter';
import { S3StorageAdapter } from '@/storage/adapters/S3StorageAdapter';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';
import { StorageWrapper } from '@/storage/StorageWrapper';

let storage: StorageWrapper | null = null;

const configDirectory = './conf';
const configPath = `${configDirectory}/storage.json`;

const saveConfig = async function (config: StorageConfig) {
  await fs.mkdir(configDirectory, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 4), 'utf8');
  resetStorage();
};

const loadConfig = async function (): Promise<StorageConfig | null> {
  try {
    const contents = await fs.readFile(configPath, 'utf8');
    return JSON.parse(contents);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
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
