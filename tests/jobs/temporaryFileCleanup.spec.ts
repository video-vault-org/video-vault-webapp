import { lstat, mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupTemporaryFiles } from '@/jobs/temporaryFileCleanup';
import fs from 'node:fs/promises';

const actualLstat = lstat;
const ctimes = new Map<string, number>();

const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 21);
const old = new Date(now - day - 1000);

async function age(path: string, date = old): Promise<void> {
  await utimes(path, date, date);
  ctimes.set(path, date.getTime());
}

describe('cleanupTemporaryFiles', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'video-vault-cleanup-'));
    ctimes.clear();
    // ctime cannot be backdated with utimes; override only that field while retaining real filesystem operations.
    jest.spyOn(fs, 'lstat').mockImplementation(((path: Parameters<typeof lstat>[0]) =>
      actualLstat(path).then((info) => {
        const ctime = ctimes.get(path.toString());
        return ctime === undefined ? info : Object.defineProperty(info, 'ctimeMs', { value: ctime });
      })) as typeof lstat);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  async function upload(videoId = 'video') {
    for (const extension of ['video', 'thumbnail']) {
      const path = join(directory, `${videoId}.${extension}`);
      await writeFile(path, extension);
      await age(path);
    }
  }

  test('deletes only files strictly older than 24 hours by status change time (ctime)', async () => {
    for (const name of ['old', 'boundary', 'recent', 'future']) await writeFile(join(directory, name), name);
    await age(join(directory, 'old'));
    await age(join(directory, 'boundary'), new Date(now - day));
    await age(join(directory, 'recent'), new Date(now - 1000));
    await age(join(directory, 'future'), new Date(now + day));
    expect(await cleanupTemporaryFiles({ directory, now })).toBe(1);
    expect((await readdir(directory)).sort()).toEqual(['boundary', 'future', 'recent']);
  });

  test('a missing directory and repeated cleanup runs are harmless', async () => {
    expect(await cleanupTemporaryFiles({ directory: join(directory, 'missing'), now })).toBe(0);
    expect(await cleanupTemporaryFiles({ directory, now })).toBe(0);
    expect(await cleanupTemporaryFiles({ directory, now })).toBe(0);
  });

  test.each(['video', 'thumbnail'])('deletes an expired %s independently of the other file', async (extension) => {
    await upload();
    const recent = extension === 'video' ? 'thumbnail' : 'video';
    await age(join(directory, `video.${recent}`), new Date(now - 1000));
    expect(await cleanupTemporaryFiles({ directory, now })).toBe(1);
    expect(await readdir(directory)).toEqual([`video.${recent}`]);
  });

  test('skips both files while their matching busy file exists, but still deletes unrelated expired files', async () => {
    await upload('locked');
    await upload('other');
    await writeFile(join(directory, '.locked.busy'), '');
    expect(await cleanupTemporaryFiles({ directory, now })).toBe(2);
    expect((await readdir(directory)).sort()).toEqual(['.locked.busy', 'locked.thumbnail', 'locked.video']);
    await rm(join(directory, '.locked.busy'));
    expect(await cleanupTemporaryFiles({ directory, now })).toBe(2);
  });

  test('deletes old busy files by their own ctime', async () => {
    await writeFile(join(directory, '.abandoned.busy'), '');
    await age(join(directory, '.abandoned.busy'));
    expect(await cleanupTemporaryFiles({ directory, now })).toBe(1);
    expect(await readdir(directory)).toEqual([]);
  });

  test('ignores subdirectories and symbolic links without inspecting their contents', async () => {
    const nested = join(directory, '.uploads');
    await mkdir(nested);
    await writeFile(join(nested, 'old'), 'preserved');
    await age(join(nested, 'old'));
    await age(nested);
    await symlink(join(nested, 'old'), join(directory, 'link'));
    expect(await cleanupTemporaryFiles({ directory, now })).toBe(0);
    expect((await lstat(join(directory, 'link'))).isSymbolicLink()).toBe(true);
    expect(await readdir(nested)).toEqual(['old']);
  });

  test('uses ctime independently of mtime', async () => {
    const recentStatus = join(directory, 'recent-status');
    const oldStatus = join(directory, 'old-status');
    await writeFile(recentStatus, 'keep');
    await writeFile(oldStatus, 'delete');
    await utimes(recentStatus, old, old);
    ctimes.set(recentStatus, now - 1000);
    await utimes(oldStatus, new Date(now), new Date(now));
    ctimes.set(oldStatus, old.getTime());
    expect(await cleanupTemporaryFiles({ directory, now })).toBe(1);
    expect(await readdir(directory)).toEqual(['recent-status']);
  });
});
