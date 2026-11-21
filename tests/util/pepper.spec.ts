import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensurePepper } from '@/util/pepper';

describe('ensurePepper', () => {
  let directory: string;
  let filePath: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'video-vault-pepper-'));
    filePath = join(directory, '.pepper');
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  test('creates exactly 32 random bytes as 64 hexadecimal characters with private file permissions', async () => {
    const random = jest.spyOn(crypto, 'randomBytes').mockImplementationOnce(() => Buffer.alloc(32, 0xab));
    const pepper = await ensurePepper({ filePath });
    expect(random).toHaveBeenCalledWith(32);
    expect(pepper).toBe('ab'.repeat(32));
    expect(Buffer.from(pepper, 'hex')).toHaveLength(32);
    expect(await readFile(filePath, 'utf8')).toBe(pepper);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(['.pepper']);
  });

  test('reuses existing contents without changing their spelling or rewriting the file', async () => {
    const original = 'AB'.repeat(32);
    await writeFile(filePath, original);
    const before = await stat(filePath);
    const random = jest.spyOn(crypto, 'randomBytes');
    expect(await ensurePepper({ filePath })).toBe(original);
    expect(random).not.toHaveBeenCalled();
    expect((await stat(filePath)).mtimeMs).toBe(before.mtimeMs);
  });

  test('concurrent initializations all return the same fully written pepper and leave no temporary files', async () => {
    const peppers = await Promise.all(Array.from({ length: 10 }, () => ensurePepper({ filePath })));
    expect(new Set(peppers).size).toBe(1);
    expect(peppers[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(filePath, 'utf8')).toBe(peppers[0]);
    expect(await readdir(directory)).toEqual(['.pepper']);
  });

  test('generates different peppers for independent installations', async () => {
    expect(await ensurePepper({ filePath })).not.toBe(await ensurePepper({ filePath: join(directory, '.second-pepper') }));
  });

  test.each(['', 'short', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'a'.repeat(64) + '\n'])('rejects malformed stored contents without replacing them (%j)', async (contents) => {
    await writeFile(filePath, contents);
    await expect(ensurePepper({ filePath })).rejects.toThrow('exactly 64 hexadecimal');
    expect(await readFile(filePath, 'utf8')).toBe(contents);
    expect(await readdir(directory)).toEqual(['.pepper']);
  });

  test('propagates read errors without attempting to replace an unreadable existing file', async () => {
    const error = Object.assign(new Error('Access denied'), { code: 'EACCES' });
    jest.spyOn(fs, 'readFile').mockRejectedValueOnce(error);
    const write = jest.spyOn(fs, 'writeFile');
    await expect(ensurePepper({ filePath })).rejects.toBe(error);
    expect(write).not.toHaveBeenCalled();
  });

  test('removes its temporary file when publishing the pepper fails', async () => {
    const error = Object.assign(new Error('Access denied'), { code: 'EACCES' });
    jest.spyOn(fs, 'link').mockRejectedValueOnce(error);
    await expect(ensurePepper({ filePath })).rejects.toBe(error);
    expect(await readdir(directory)).toEqual([]);
  });

  test('propagates write failures without creating the target file', async () => {
    const error = Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
    jest.spyOn(fs, 'writeFile').mockRejectedValueOnce(error);
    await expect(ensurePepper({ filePath })).rejects.toBe(error);
    expect(await readdir(directory)).toEqual([]);
  });
});
