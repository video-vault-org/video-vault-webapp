import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { MetaConfig, metaConfigSchema } from './config/MetaConfig';

/** Reads ./conf/meta.json; only a missing file returns null. Invalid or unreadable configurations cause an error. */
const loadConfig = async function (): Promise<MetaConfig | null> {
  try {
    return metaConfigSchema.parse(JSON.parse(await readFile('./conf/meta.json', { encoding: 'utf8' })));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
};

/** Validates field definitions and ordered sorting rules before saving ./conf/meta.json. */
const saveConfig = async function (config: MetaConfig): Promise<void> {
  const validated = metaConfigSchema.parse(config);
  await mkdir('./conf', { recursive: true });
  await writeFile('./conf/meta.json', JSON.stringify(validated, null, 4), 'utf8');
};

export { loadConfig, saveConfig };
