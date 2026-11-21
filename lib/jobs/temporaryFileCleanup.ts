import { access, lstat, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { BackgroundLogger } from '@/http/logging';

const day = 24 * 60 * 60 * 1000;
const hour = 60 * 60 * 1000;

/**
 * Deletes regular files directly inside the temporary directory when their ctime is more than 24 hours old.
 * Video and thumbnail files are checked independently and skipped while .<videoId>.busy exists.
 * Busy files, subdirectories and symbolic links are ignored. A missing directory or concurrently removed file is harmless.
 * @returns The number of deleted files.
 * @throws If filesystem access fails for reasons other than a missing file.
 */
async function cleanupTemporaryFiles({ directory = './tmp', now = Date.now() }: { directory?: string; now?: number } = {}): Promise<number> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return 0;
    throw error;
  }

  const cutoff = now - day;
  let deleted = 0;

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.endsWith('.busy')) continue;
    const upload = /^(.+)\.(video|thumbnail)$/.exec(entry.name);
    if (upload) {
      try {
        await access(join(directory, `.${upload[1]}.busy`));
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
      }
    }
    try {
      const path = join(directory, entry.name);
      const info = await lstat(path);
      if (!info.isFile() || info.ctimeMs >= cutoff) continue;
      await unlink(path);
      deleted++;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    }
  }

  return deleted;
}

/**
 * Starts immediate and hourly cleanup runs. Runs never overlap and failures are logged without stopping the schedule.
 * The timer does not keep Node alive. The returned idempotent stop function clears it and waits for any active run.
 */
function startTemporaryFileCleanup({ directory = './tmp', intervalMs = hour, logger = console }: { directory?: string; intervalMs?: number; logger?: BackgroundLogger } = {}): () => Promise<void> {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0 || intervalMs > 2 ** 31 - 1) throw new RangeError('Invalid cleanup interval');
  let running: Promise<void> | undefined;
  let stopped = false;

  const run = () => {
    if (stopped || running) return;
    running = cleanupTemporaryFiles({ directory })
      .then((deleted) => {
        if (deleted > 0) logger.info({ deleted }, 'Expired temporary files deleted');
      })
      .catch((error: unknown) => {
        logger.error({ err: error instanceof Error ? error : new Error('Unknown cleanup error') }, 'Temporary file cleanup failed');
      })
      .finally(() => {
        running = undefined;
      });
  };

  const timer = setInterval(run, intervalMs);
  timer.unref();
  run();

  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}

export { cleanupTemporaryFiles, startTemporaryFileCleanup };
