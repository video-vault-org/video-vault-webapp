import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig } from '@/app';

describe('application configuration', () => {
  let directory: string;
  let originalDirectory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'video-vault-app-'));
    originalDirectory = process.cwd();
    process.chdir(directory);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    process.chdir(originalDirectory);
    await rm(directory, { recursive: true, force: true });
  });

  test('returns null for a missing configuration without creating files', async () => {
    expect(await loadConfig()).toBeNull();
    await expect(readFile('./conf/app.json')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('saves a trimmed title as formatted JSON and loads it again', async () => {
    await saveConfig({ title: '  Meine Videos 🎬  ' });
    expect(await readFile('./conf/app.json', 'utf8')).toBe(JSON.stringify({ title: 'Meine Videos 🎬' }, null, 4));
    expect(await loadConfig()).toEqual({ title: 'Meine Videos 🎬' });
  });

  test.each(['{', '', '{}', '{"title":123}', '{"title":" "}', JSON.stringify({ title: 'a'.repeat(101) }), '{"title":"Vault","unknown":true}'])('rejects malformed or invalid stored configuration (%s)', async (contents) => {
    await mkdir('./conf');
    await writeFile('./conf/app.json', contents);
    await expect(loadConfig()).rejects.toThrow();
    expect(await readFile('./conf/app.json', 'utf8')).toBe(contents);
  });

  test.each(['', ' ', 'a'.repeat(101)])('rejects invalid titles without replacing the existing configuration (%j)', async (title) => {
    await saveConfig({ title: 'Existing' });
    await expect(saveConfig({ title })).rejects.toThrow();
    expect(await loadConfig()).toEqual({ title: 'Existing' });
  });

  test('propagates read errors rather than treating unreadable configuration as missing', async () => {
    const error = Object.assign(new Error('Access denied'), { code: 'EACCES' });
    jest.spyOn(fs, 'readFile').mockRejectedValueOnce(error);
    await expect(loadConfig()).rejects.toBe(error);
  });

  test.each(['mkdir', 'writeFile'] as const)('propagates %s errors', async (operation) => {
    const error = new Error('Write failed');
    jest.spyOn(fs, operation).mockRejectedValueOnce(error);
    await expect(saveConfig({ title: 'Vault' })).rejects.toBe(error);
  });
});
