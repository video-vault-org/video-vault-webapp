import mockFS from 'mock-fs';
import { loadConfig, saveConfig } from '@/frontend';
import { exists } from '#/util';
import fs from 'fs/promises';
import { FrontendConfig } from '@/frontend/types/FrontendConfig';

describe('frontend', (): void => {
  const conf: FrontendConfig = { title: 'title', logo: 'logo', videoMeta: [{ name: 'name', type: 'string', encrypted: true }] };

  afterEach(async (): Promise<void> => {
    mockFS.restore();
  });

  test('saveConfig saves config', async () => {
    mockFS({});

    await saveConfig(conf);

    expect(await exists('./conf/frontend.json')).toBe(true);
    expect(JSON.parse((await fs.readFile('./conf/frontend.json'))?.toString('utf8'))).toEqual(conf);
  });

  test('loadConfig loads config.', async () => {
    mockFS({ './conf': { 'frontend.json': JSON.stringify(conf) } });

    const config = await loadConfig();

    expect(config).toEqual(conf);
  });

  test('loadConfig returns null.', async () => {
    mockFS();

    const config = await loadConfig();

    expect(config).toBeNull();
  });
});
