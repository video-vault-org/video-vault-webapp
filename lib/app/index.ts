import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { AppConfig, appConfigSchema } from './config/AppConfig';

/** Reads ./conf/app.json; missing files return null, invalid or unreadable files cause an error. */
async function loadConfig(): Promise<AppConfig | null> {
  try {
    return appConfigSchema.parse(JSON.parse(await readFile('./conf/app.json', 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
}

/** Validates application settings and saves ./conf/app.json, creating the configuration directory if needed. */
async function saveConfig(config: AppConfig): Promise<void> {
  const validated = appConfigSchema.parse(config);
  await mkdir('./conf', { recursive: true });
  await writeFile('./conf/app.json', JSON.stringify(validated, null, 4), 'utf8');
}

export { loadConfig, saveConfig };
