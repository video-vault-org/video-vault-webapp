import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImagesConfig, imagesConfigSchema } from './config/ImagesConfig';
import { DEFAULT_APP_TITLE } from '@/app/config/AppConfig';
import { setPageTitle } from '@/util/html';

const imageNames = ['icon-192.png', 'icon-32.png', 'icon-512.png', 'logo.png'];
const versionMarker = '__VIDEOVAULT_IMAGES_VERSION__';

/** Reads ./conf/images.json; missing files return null, malformed or unreadable files throw. Startup defaults to the default image set. */
const loadConfig = async function (): Promise<ImagesConfig | null> {
  try {
    return imagesConfigSchema.parse(JSON.parse(await readFile('./conf/images.json', 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
};

/** Validates and saves the chosen prefix in ./conf/images.json. */
const saveConfig = async function (config: ImagesConfig): Promise<void> {
  const validated = imagesConfigSchema.parse(config);
  await mkdir('./conf', { recursive: true });
  await writeFile('./conf/images.json', JSON.stringify(validated, null, 4), 'utf8');
};

/** Lists distinct, complete image sets in deterministic order. Directories and symbolic links are excluded. */
const listImageSets = async function ({ imageDirectory = './img' }: { imageDirectory?: string } = {}): Promise<string[]> {
  const entries = await readdir(imageDirectory, { withFileTypes: true });
  const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  return [...files]
    .filter((name) => name.endsWith('.logo.png'))
    .map((name) => name.slice(0, -'.logo.png'.length))
    .filter((prefix) => imagesConfigSchema.safeParse({ prefix }).success && imageNames.every((name) => files.has(`${prefix}.${name}`)))
    .sort();
};

/**
 * Prepares static branding before listening, using the configured prefix or default.
 * Writes the configured HTML/OG title, hashes HTML and image contents, copies images to fixed public paths, and stamps the immutable worker template.
 * The footer always uses default.logo.png, copied separately as videovault-logo.png and included in the image version.
 * Repeated starts with identical HTML and images produce identical worker bytes. Neither prefix names nor file timestamps affect the hash.
 * A failed or incomplete selection throws; no files are changed until the complete set and worker template have been read.
 * Requires a frontend build containing .sw.template.js. Does not modify bootstrap or the browser's encrypted catalog.
 * @returns The SHA-256 image version used in the service worker cache name.
 */
const prepareFrontend = async function ({ staticDirectory = './public', imageDirectory = './img', prefix, title = DEFAULT_APP_TITLE }: { staticDirectory?: string; imageDirectory?: string; prefix?: string; title?: string } = {}): Promise<string> {
  const config = imagesConfigSchema.parse({ prefix: prefix ?? (await loadConfig())?.prefix ?? 'default' });
  if (!(await listImageSets({ imageDirectory })).includes(config.prefix)) throw new Error(`Image set "${config.prefix}" is missing or incomplete in ${imageDirectory}`);
  const images = await Promise.all(imageNames.map(async (name) => ({ name, data: await readFile(join(imageDirectory, `${config.prefix}.${name}`)) })));
  images.push({ name: 'videovault-logo.png', data: await readFile(join(imageDirectory, 'default.logo.png')) });
  const template = await readFile(join(staticDirectory, '.sw.template.js'), 'utf8');
  if (!template.includes(versionMarker)) throw new Error('Frontend service worker template is invalid; run npm run build:frontend');
  const html = setPageTitle(await readFile(join(staticDirectory, 'index.html'), 'utf8'), title);
  const hash = createHash('sha256');
  hash.update(html);
  for (const { name, data } of images) hash.update(name).update('\0').update(String(data.length)).update('\0').update(data);
  const version = hash.digest('hex');
  for (const { name, data } of images) await writeFile(join(staticDirectory, name), data);
  await writeFile(join(staticDirectory, 'index.html'), html, 'utf8');
  await writeFile(join(staticDirectory, 'sw.js'), template.split(versionMarker).join(version), 'utf8');
  return version;
};

export { loadConfig, saveConfig, listImageSets, prepareFrontend };
