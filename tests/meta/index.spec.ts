import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig } from '@/meta';
import { DEFAULT_META_CONFIG, MetaConfig, metaConfigSchema } from '@/meta/config/MetaConfig';

const field = { key: 'actors', name: 'Darsteller', type: 'text' as const, multiple: true, required: false, showInDetails: true, useAsFilter: true };
const config: MetaConfig = {
  recorded: { withTime: true, useAsFilter: false },
  fields: [field],
  sorting: [
    { source: 'meta', key: 'actors', direction: 'asc' },
    { source: 'title', direction: 'desc' }
  ]
};

describe('metadata configuration persistence', () => {
  let directory: string;
  let originalDirectory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'video-vault-meta-'));
    originalDirectory = process.cwd();
    process.chdir(directory);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    process.chdir(originalDirectory);
    await rm(directory, { recursive: true, force: true });
  });

  test('returns null for a missing file without creating it', async () => {
    expect(await loadConfig()).toBeNull();
    await expect(readFile('./conf/meta.json')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('writes formatted UTF-8 JSON and preserves flags, free-array types and sort priority', async () => {
    await saveConfig(config);
    expect(await readFile('./conf/meta.json', 'utf8')).toBe(JSON.stringify(config, null, 4));
    expect(await loadConfig()).toEqual(config);
  });

  test.each(['', '{', '{}', JSON.stringify({ ...DEFAULT_META_CONFIG, sorting: [{ source: 'meta', key: 'missing', direction: 'asc' }] })])('rejects malformed or invalid stored configuration (%s)', async (contents) => {
    await mkdir('./conf');
    await writeFile('./conf/meta.json', contents);
    await expect(loadConfig()).rejects.toThrow();
    expect(await readFile('./conf/meta.json', 'utf8')).toBe(contents);
  });

  test('validates before overwriting an existing file', async () => {
    await saveConfig(config);
    await expect(saveConfig({ ...config, fields: [field, field] })).rejects.toThrow('Metadata keys must be unique');
    expect(await loadConfig()).toEqual(config);
  });

  test('propagates unreadable-file errors instead of using defaults', async () => {
    const error = Object.assign(new Error('Access denied'), { code: 'EACCES' });
    jest.spyOn(fs, 'readFile').mockRejectedValueOnce(error);
    await expect(loadConfig()).rejects.toBe(error);
  });

  test.each(['mkdir', 'writeFile'] as const)('propagates %s failures', async (operation) => {
    const error = new Error('Write failed');
    jest.spyOn(fs, operation).mockRejectedValueOnce(error);
    await expect(saveConfig(config)).rejects.toBe(error);
  });
});

describe('metadata configuration validation', () => {
  test('uses the agreed defaults when no file exists', () => {
    expect(metaConfigSchema.parse(DEFAULT_META_CONFIG)).toEqual({
      recorded: { withTime: false, useAsFilter: true },
      fields: [],
      sorting: [
        { source: 'recorded', direction: 'desc' },
        { source: 'title', direction: 'asc' }
      ]
    });
  });

  test.each(['text', 'number', 'boolean', 'date', 'datetime'] as const)('accepts scalar %s fields', (type) => {
    expect(metaConfigSchema.parse({ ...config, fields: [{ ...field, type, multiple: false }] }).fields[0].type).toBe(type);
  });

  test.each(['text', 'number', 'date', 'datetime'] as const)('accepts free arrays of %s without predefined options', (type) => {
    expect(metaConfigSchema.parse({ ...config, fields: [{ ...field, type }] }).fields[0]).toEqual({ ...field, type });
  });

  test('distinguishes metadata named title/recorded from the built-in sort fields', () => {
    const fields = [
      { ...field, key: 'title' },
      { ...field, key: 'recorded' }
    ];
    const sorting = [...DEFAULT_META_CONFIG.sorting, { source: 'meta', key: 'title', direction: 'asc' }, { source: 'meta', key: 'recorded', direction: 'desc' }];
    expect(metaConfigSchema.parse({ ...config, fields, sorting }).sorting).toHaveLength(4);
  });

  test.each([
    { ...config, fields: [field, field] },
    { ...config, fields: [{ ...field, key: 'constructor' }] },
    { ...config, fields: [{ ...field, key: '__proto__' }] },
    { ...config, fields: [{ ...field, key: 'has spaces' }] },
    { ...config, fields: [{ ...field, name: ' ' }] },
    { ...config, fields: [{ ...field, type: 'unknown' }] },
    { ...config, fields: [{ ...field, type: 'boolean', multiple: true }] },
    { ...config, fields: [{ ...field, required: 'yes' }] },
    { ...config, fields: [{ ...field, useAsFilter: 'yes' }] },
    { ...config, fields: [{ ...field, useAsFilter: undefined }] },
    { ...config, fields: [{ ...field, options: ['not-supported'] }] },
    { ...config, recorded: { withTime: false } },
    { ...config, sorting: [{ source: 'title', direction: 'sideways' }] },
    { ...config, sorting: [{ source: 'meta', key: 'unknown', direction: 'asc' }] },
    {
      ...config,
      sorting: [
        { source: 'title', direction: 'asc' },
        { source: 'title', direction: 'desc' }
      ]
    },
    {
      ...config,
      sorting: [
        { source: 'meta', key: 'actors', direction: 'asc' },
        { source: 'meta', key: 'actors', direction: 'desc' }
      ]
    },
    { ...config, sorting: [{ source: 'title', key: 'actors', direction: 'asc' }] },
    { ...config, privateInternalField: 'never-publish' }
  ])('rejects invalid flags, keys, types, references and duplicate sort rules (%#)', (invalid) => {
    expect(metaConfigSchema.safeParse(invalid).success).toBe(false);
  });
});
