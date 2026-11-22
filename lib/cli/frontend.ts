import { z } from 'zod';
import { ask } from './prompt';
import { listImageSets, loadConfig, saveConfig } from '@/images';

/** Selects a complete ./img image set and saves ./conf/images.json; confirms before replacing an existing selection. */
const initializeFrontendConfig = async function (): Promise<void> {
  const prefixes = await listImageSets();
  if (prefixes.length === 0) throw new Error('No complete image sets found in ./img');
  const existing = await loadConfig();
  const prefix = await ask(
    {
      type: 'select',
      name: 'value',
      message: 'Frontend image set',
      initial: Math.max(0, prefixes.indexOf(existing?.prefix ?? 'default')),
      choices: prefixes.map((prefix) => ({ title: prefix, value: prefix }))
    },
    z.enum(prefixes as [string, ...string[]])
  );
  if (existing && !(await ask({ type: 'confirm', name: 'value', message: 'Replace existing image configuration?', initial: false }, z.boolean()))) {
    throw new Error('Image configuration replacement declined');
  }
  await saveConfig({ prefix });
};

export { initializeFrontendConfig };
