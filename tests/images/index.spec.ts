import { mkdtemp, mkdir, readFile, writeFile, rm, cp, symlink, utimes } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig, listImageSets, prepareFrontend } from '@/images';

const names = ['logo.png', 'icon-32.png', 'icon-192.png', 'icon-512.png'];
const template = 'const cacheName="vault-shell-build-1-__VIDEOVAULT_IMAGES_VERSION__";';
const page = '<title>VideoVault</title><meta property="og:title" content="VideoVault" /><meta property="og:image" content="__VIDEOVAULT_OG_IMAGE_URL__" />';

describe('frontend images', () => {
  let directory: string;
  let originalDirectory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vault-images-'));
    originalDirectory = process.cwd();
    process.chdir(directory);
    await mkdir('img');
    await mkdir('public');
    for (const name of names) await writeFile(`img/default.${name}`, `original ${name}`);
    await writeFile('public/.sw.template.js', template);
    await writeFile('public/index.html', page);
    await writeFile('public/sw.js', 'previous worker');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    process.chdir(originalDirectory);
    await rm(directory, { recursive: true, force: true });
  });

  test('missing configuration returns null and startup uses the default images', async () => {
    expect(await loadConfig()).toBeNull();
    const version = await prepareFrontend();
    expect(version).toMatch(/^[0-9a-f]{64}$/);
    for (const name of names) expect(await readFile(`public/${name}`, 'utf8')).toBe(`original ${name}`);
    expect(await readFile('public/sw.js', 'utf8')).toBe(template.replace('__VIDEOVAULT_IMAGES_VERSION__', version));
    expect(await readFile('public/.sw.template.js', 'utf8')).toBe(template);
    expect(await readFile('public/videovault-logo.png', 'utf8')).toBe('original logo.png');
  });

  test('saves and loads the selected prefix as formatted JSON', async () => {
    await saveConfig({ prefix: 'fm' });
    expect(await loadConfig()).toEqual({ prefix: 'fm' });
    expect(await readFile('conf/images.json', 'utf8')).toBe(JSON.stringify({ prefix: 'fm' }, null, 4));
  });

  test.each(['', '../escape', 'has.dot', '/absolute', 'has spaces', 'x'.repeat(65)])('rejects unsafe or invalid prefixes without replacing the configuration (%j)', async (prefix) => {
    await saveConfig({ prefix: 'default' });
    await expect(saveConfig({ prefix })).rejects.toThrow();
    expect(await loadConfig()).toEqual({ prefix: 'default' });
  });

  test.each(['{', '{}', '{"prefix":1}', '{"prefix":"fm","extra":true}'])('rejects malformed stored configuration (%s)', async (contents) => {
    await mkdir('conf');
    await writeFile('conf/images.json', contents);
    await expect(loadConfig()).rejects.toThrow();
    await expect(prepareFrontend()).rejects.toThrow();
    expect(await readFile('public/sw.js', 'utf8')).toBe('previous worker');
  });

  test('does not treat unreadable configuration as missing', async () => {
    const error = Object.assign(new Error('Denied'), { code: 'EACCES' });
    jest.spyOn(fs, 'readFile').mockRejectedValueOnce(error);
    await expect(loadConfig()).rejects.toBe(error);
  });

  test.each(['mkdir', 'writeFile'] as const)('propagates configuration %s failures', async (operation) => {
    const error = new Error('Write failed');
    jest.spyOn(fs, operation).mockRejectedValueOnce(error);
    await expect(saveConfig({ prefix: 'default' })).rejects.toBe(error);
  });

  test('lists only distinct complete regular-file sets, sorted by prefix', async () => {
    for (const name of names) await cp(`img/default.${name}`, `img/fm.${name}`);
    await writeFile('img/partial.logo.png', 'partial');
    await writeFile('img/unrelated.txt', 'unrelated');
    for (const name of names.filter((name) => name !== 'logo.png')) {
      await cp(`img/default.${name}`, `img/directory.${name}`);
      await cp(`img/default.${name}`, `img/link.${name}`);
    }
    await mkdir('img/directory.logo.png');
    await symlink(join(directory, 'img/default.logo.png'), 'img/link.logo.png');
    await writeFile('img/invalid.prefix.logo.png', 'ignored');
    expect(await listImageSets()).toEqual(['default', 'fm']);
    expect(await listImageSets({ imageDirectory: join(directory, 'public') })).toEqual([]);
  });

  test('propagates directory lookup failures', async () => {
    await expect(listImageSets({ imageDirectory: 'missing' })).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('uses the configured set and hashes actual bytes independently of prefix and modification time', async () => {
    const first = await prepareFrontend();
    const originalWorker = await readFile('public/sw.js', 'utf8');
    for (const name of names) {
      await cp(`img/default.${name}`, `img/fm.${name}`);
      await utimes(`img/fm.${name}`, new Date(0), new Date(0));
    }
    await saveConfig({ prefix: 'fm' });
    expect(await prepareFrontend()).toBe(first);
    expect(await readFile('public/sw.js', 'utf8')).toBe(originalWorker);
    await writeFile('img/fm.logo.png', 'replacement logo');
    const second = await prepareFrontend();
    expect(second).not.toBe(first);
    expect(await readFile('public/logo.png', 'utf8')).toBe('replacement logo');
    expect(await readFile('public/videovault-logo.png', 'utf8')).toBe('original logo.png');
    expect(await readFile('public/sw.js', 'utf8')).toContain(second);
    expect(await readFile('public/sw.js', 'utf8')).not.toContain(first);
    expect(await prepareFrontend()).toBe(second);
    expect(await prepareFrontend({ prefix: 'default' })).toBe(first);
  });

  test('changing the original footer logo updates the worker version while retaining the selected header logo', async () => {
    for (const name of names) await cp(`img/default.${name}`, `img/fm.${name}`);
    await writeFile('img/fm.logo.png', 'custom header logo');
    const first = await prepareFrontend({ prefix: 'fm' });
    await writeFile('img/default.logo.png', 'updated original footer logo');
    const second = await prepareFrontend({ prefix: 'fm' });
    expect(second).not.toBe(first);
    expect(await readFile('public/logo.png', 'utf8')).toBe('custom header logo');
    expect(await readFile('public/videovault-logo.png', 'utf8')).toBe('updated original footer logo');
    expect(await readFile('public/sw.js', 'utf8')).toContain(second);
    expect(await prepareFrontend({ prefix: 'fm' })).toBe(second);
  });

  test('a custom set still requires the original footer logo before changing public files', async () => {
    for (const name of names) await cp(`img/default.${name}`, `img/fm.${name}`);
    await rm('img/default.logo.png');
    await expect(prepareFrontend({ prefix: 'fm' })).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile('public/sw.js', 'utf8')).toBe('previous worker');
    await expect(readFile('public/logo.png')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('preserves unrelated public files and supports a custom static directory', async () => {
    await mkdir('custom');
    await writeFile('custom/.sw.template.js', template);
    await writeFile('custom/index.html', page);
    await writeFile('custom/other.txt', 'keep');
    await prepareFrontend({ staticDirectory: 'custom', imageDirectory: 'img', prefix: 'default' });
    expect(await readFile('custom/other.txt', 'utf8')).toBe('keep');
    expect(await readFile('custom/logo.png', 'utf8')).toBe('original logo.png');
    expect(await readFile('public/sw.js', 'utf8')).toBe('previous worker');
  });

  test.each(['missing', 'partial'])('refuses an explicitly selected incomplete set without changing public files (%s)', async (prefix) => {
    await writeFile('img/partial.logo.png', 'incomplete');
    await saveConfig({ prefix });
    await expect(prepareFrontend()).rejects.toThrow(`Image set "${prefix}" is missing or incomplete`);
    expect(await readFile('public/sw.js', 'utf8')).toBe('previous worker');
    await expect(readFile('public/logo.png')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('requires a valid immutable build template before writing any images', async () => {
    await writeFile('public/.sw.template.js', 'old build');
    await expect(prepareFrontend()).rejects.toThrow('run npm run build:frontend');
    await expect(readFile('public/logo.png')).rejects.toMatchObject({ code: 'ENOENT' });
    await rm('public/.sw.template.js');
    await expect(prepareFrontend()).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('propagates source read and destination write failures', async () => {
    const error = new Error('Unavailable');
    jest.spyOn(fs, 'readFile').mockRejectedValueOnce(error);
    await expect(prepareFrontend({ prefix: 'default' })).rejects.toBe(error);
    jest.spyOn(fs, 'writeFile').mockRejectedValueOnce(error);
    await expect(prepareFrontend({ prefix: 'default' })).rejects.toBe(error);
  });

  test('writes escaped titles into the static HTML and OG metadata and refreshes the offline cache when the title changes', async () => {
    const title = 'Family & <Friends> "$&"';
    const first = await prepareFrontend({ title });
    const html = await readFile('public/index.html', 'utf8');
    expect(html).toContain('<title>Family &amp; &lt;Friends&gt; &quot;$&amp;&quot;</title>');
    expect(html).toContain('<meta property="og:title" content="Family &amp; &lt;Friends&gt; &quot;$&amp;&quot;" />');
    expect(html).toContain('content="__VIDEOVAULT_OG_IMAGE_URL__"');
    expect(await prepareFrontend({ title })).toBe(first);
    const second = await prepareFrontend({ title: 'Another archive' });
    expect(second).not.toBe(first);
    expect(await readFile('public/index.html', 'utf8')).toContain('<title>Another archive</title>');
    expect(await readFile('public/sw.js', 'utf8')).toContain(second);
  });
});
