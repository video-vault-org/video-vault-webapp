import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureInstanceSalt } from '@/util/instanceSalt';

describe('ensureInstanceSalt', () => {
  let directory: string;
  let filePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'video-vault-instance-salt-'));
    filePath = join(directory, '.salt');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  test('creates exactly 32 random bytes as 64 hexadecimal characters with private file permissions', async () => {
    const random = jest.spyOn(crypto, 'randomBytes').mockImplementationOnce(() => Buffer.alloc(32, 0xab));
    const instanceSalt = await ensureInstanceSalt({ filePath });
    expect(random).toHaveBeenCalledWith(32);
    expect(instanceSalt).toBe('ab'.repeat(32));
    expect(Buffer.from(instanceSalt, 'hex')).toHaveLength(32);
    expect(await readFile(filePath, 'utf8')).toBe(instanceSalt);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(['.salt']);
  });

  test('reuses existing contents without changing their spelling or rewriting the file', async () => {
    const original = 'AB'.repeat(32);
    await writeFile(filePath, original);
    const before = await stat(filePath);
    const random = jest.spyOn(crypto, 'randomBytes');
    expect(await ensureInstanceSalt({ filePath })).toBe(original);
    expect(random).not.toHaveBeenCalled();
    expect((await stat(filePath)).mtimeMs).toBe(before.mtimeMs);
  });

  test('uses ./.salt by default and reuses the stored value', async () => {
    const originalDirectory = process.cwd();
    try {
      process.chdir(directory);
      const salt = await ensureInstanceSalt();
      expect(await readFile('.salt', 'utf8')).toBe(salt);
      expect(await ensureInstanceSalt()).toBe(salt);
      expect(await readdir(directory)).toEqual(['.salt']);
    } finally {
      process.chdir(originalDirectory);
    }
  });

  test('concurrent initializations all return the same fully written instance salt and leave no temporary files', async () => {
    const instanceSalts = await Promise.all(Array.from({ length: 10 }, () => ensureInstanceSalt({ filePath })));
    expect(new Set(instanceSalts).size).toBe(1);
    expect(instanceSalts[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(filePath, 'utf8')).toBe(instanceSalts[0]);
    expect(await readdir(directory)).toEqual(['.salt']);
  });

  test('generates different instance salts for independent installations', async () => {
    expect(await ensureInstanceSalt({ filePath })).not.toBe(await ensureInstanceSalt({ filePath: join(directory, '.second-salt') }));
  });

  test.each(['', 'short', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'a'.repeat(64) + '\n'])('rejects malformed stored contents without replacing them (%j)', async (contents) => {
    await writeFile(filePath, contents);
    await expect(ensureInstanceSalt({ filePath })).rejects.toThrow('exactly 64 hexadecimal');
    expect(await readFile(filePath, 'utf8')).toBe(contents);
    expect(await readdir(directory)).toEqual(['.salt']);
  });

  test('propagates read errors without attempting to replace an unreadable existing file', async () => {
    const error = Object.assign(new Error('Access denied'), { code: 'EACCES' });
    jest.spyOn(fs, 'readFile').mockRejectedValueOnce(error);
    const write = jest.spyOn(fs, 'writeFile');
    await expect(ensureInstanceSalt({ filePath })).rejects.toBe(error);
    expect(write).not.toHaveBeenCalled();
  });

  test('removes its temporary file when publishing the instance salt fails', async () => {
    const error = Object.assign(new Error('Access denied'), { code: 'EACCES' });
    jest.spyOn(fs, 'link').mockRejectedValueOnce(error);
    await expect(ensureInstanceSalt({ filePath })).rejects.toBe(error);
    expect(await readdir(directory)).toEqual([]);
  });

  test('propagates write failures without creating the target file', async () => {
    const error = Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
    jest.spyOn(fs, 'writeFile').mockRejectedValueOnce(error);
    await expect(ensureInstanceSalt({ filePath })).rejects.toBe(error);
    expect(await readdir(directory)).toEqual([]);
  });
});
