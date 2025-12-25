import { FrontendConfig } from '@/frontend/types/FrontendConfig';
import { LocalStorageAdapter } from '@/storage/adapters/LocalStorageAdapter';

const saveConfig = async function (config: FrontendConfig) {
  const configBuffer = Buffer.from(JSON.stringify(config), 'utf8');
  await new LocalStorageAdapter({ basePath: './conf' }).save('frontend.json', configBuffer);
};

const loadConfig = async function (): Promise<FrontendConfig | null> {
  const configBuffer = await new LocalStorageAdapter({ basePath: './conf' }).read('frontend.json');
  if (!configBuffer) {
    return null;
  }
  return JSON.parse(configBuffer.toString('utf8'));
};

export { saveConfig, loadConfig };
