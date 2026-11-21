import { Dirent, Stats } from 'node:fs';
import { lstat, readdir, unlink } from 'node:fs/promises';
import { BackgroundLogger } from '@/http/logging';
import { startTemporaryFileCleanup } from '@/jobs/temporaryFileCleanup';

jest.mock('node:fs/promises', () => ({ access: jest.fn(), readdir: jest.fn(), lstat: jest.fn(), unlink: jest.fn() }));
const hour = 60 * 60 * 1000;

describe('scheduled temporary file cleanup', () => {
  let stop: (() => Promise<void>) | undefined;
  const info = jest.fn();
  const error = jest.fn();
  const logger = { info, error } as BackgroundLogger;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    jest.mocked(readdir).mockResolvedValue([]);
  });
  afterEach(async () => {
    await stop?.();
    stop = undefined;
    jest.useRealTimers();
  });

  test('runs immediately and hourly, stops idempotently and leaves no timers', async () => {
    stop = startTemporaryFileCleanup({ logger });
    await jest.advanceTimersByTimeAsync(0);
    expect(readdir).toHaveBeenCalledWith('./tmp', { withFileTypes: true });
    expect(readdir).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(hour - 1);
    expect(readdir).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(readdir).toHaveBeenCalledTimes(2);
    await stop();
    await stop();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(hour);
    expect(readdir).toHaveBeenCalledTimes(2);
  });

  test('unrefs its timer so it cannot keep Node alive', async () => {
    const interval = jest.spyOn(global, 'setInterval');
    stop = startTemporaryFileCleanup({ logger });
    expect(interval.mock.results[0].value.hasRef()).toBe(false);
    interval.mockRestore();
  });

  test('supports an explicit directory and interval', async () => {
    stop = startTemporaryFileCleanup({ directory: '/custom/tmp', intervalMs: 1000, logger });
    await jest.advanceTimersByTimeAsync(1000);
    expect(readdir).toHaveBeenCalledWith('/custom/tmp', { withFileTypes: true });
    expect(readdir).toHaveBeenCalledTimes(2);
  });

  test('does not overlap runs and waits for an active cleanup during shutdown', async () => {
    let finish!: (entries: Dirent[]) => void;
    jest.mocked(readdir).mockImplementationOnce(
      () =>
        new Promise<Dirent[]>((resolve) => {
          finish = resolve;
        }) as ReturnType<typeof readdir>
    );
    stop = startTemporaryFileCleanup({ logger });
    await jest.advanceTimersByTimeAsync(3 * hour);
    expect(readdir).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish([]);
    await stopping;
    expect(stopped).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('logs failures and retries at the next scheduled run', async () => {
    const failure = new Error('Permission denied');
    jest.mocked(readdir).mockRejectedValueOnce(failure);
    stop = startTemporaryFileCleanup({ logger });
    await jest.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith({ err: failure }, 'Temporary file cleanup failed');
    await jest.advanceTimersByTimeAsync(hour);
    expect(readdir).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
  });

  test('logs deleted file counts, keeps empty runs quiet', async () => {
    jest.mocked(readdir).mockResolvedValueOnce([{ name: 'old', isFile: () => true, isDirectory: () => false }] as Dirent[]);
    jest.mocked(lstat).mockResolvedValue({ isFile: () => true, ctimeMs: 0 } as Stats);
    jest.mocked(unlink).mockResolvedValue(undefined);
    stop = startTemporaryFileCleanup({ logger });
    await jest.advanceTimersByTimeAsync(0);
    expect(info).toHaveBeenCalledWith({ deleted: 1 }, 'Expired temporary files deleted');
    await jest.advanceTimersByTimeAsync(hour);
    expect(info).toHaveBeenCalledTimes(1);
  });

  test.each([0, -1, NaN, Infinity, 0.5, 2 ** 31])('rejects invalid interval %s before starting work', (intervalMs) => {
    expect(() => startTemporaryFileCleanup({ intervalMs, logger })).toThrow(RangeError);
    expect(readdir).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
