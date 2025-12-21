import crypto from 'crypto';
import { loadConfig as loadDbConfig } from '@/db';
import { loadConfig as loadStorageConfig } from '@/storage';
import { loadConfig as loadFrontendConfig } from '@/frontend';
import { LocalStorageAdapter } from '@/storage/adapters/LocalStorageAdapter';

const isInit = async function (): Promise<boolean> {
  const dbConfig = await loadDbConfig();
  const storageConfig = await loadStorageConfig();
  const frontendConfig = await loadFrontendConfig();
  return !dbConfig || !storageConfig || !frontendConfig;
};

const initialize = async function () {
  const init = await isInit();

  if (init) {
    const key = crypto.randomBytes(20).toString('hex');
    await new LocalStorageAdapter({ basePath: './' }).save('initKey', Buffer.from(key, 'utf8'));
    console.log(`initKey: ${key}`);
  }
};

const authorizeInit = async function (givenKey: string | null): Promise<boolean> {
  const keyBuffer = await new LocalStorageAdapter({ basePath: './' }).read('initKey');
  if (!keyBuffer) {
    return false;
  }

  const key = keyBuffer.toString('utf8');
  return givenKey === key;
};

export { isInit, initialize, authorizeInit };
