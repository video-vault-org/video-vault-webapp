import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { startServer } from '@/server';
import { ensureInstanceSalt } from '@/util/instanceSalt';
import { startTemporaryFileCleanup } from '@/jobs/temporaryFileCleanup';
import { loadDb, resetDb } from '@/db';
import { loadStorage, resetStorage } from '@/storage';
import { AuthService } from '@/service/AuthService';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';
import { StorageWrapper } from '@/storage/StorageWrapper';

jest.mock('@/util/instanceSalt', () => ({ ensureInstanceSalt: jest.fn() }));

jest.mock('@/jobs/temporaryFileCleanup', () => ({ startTemporaryFileCleanup: jest.fn() }));

jest.mock('@/db', () => ({ loadDb: jest.fn(), resetDb: jest.fn() }));
jest.mock('@/storage', () => ({ loadStorage: jest.fn(), resetStorage: jest.fn() }));

describe('startServer', () => {
  let directory: string;
  let running: Awaited<ReturnType<typeof startServer>> | undefined;
  let occupying: Server | undefined;
  const environment = { ...process.env };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'video-vault-server-'));
    await writeFile(join(directory, 'index.html'), 'VideoVault');
    jest.mocked(ensureInstanceSalt).mockReset().mockResolvedValue('ab'.repeat(32));
    jest.mocked(loadDb).mockResolvedValue(new InMemoryDatabaseAdapter());
    jest.mocked(loadStorage).mockResolvedValue(new StorageWrapper(new InMemoryStorageAdapter()));
    jest.mocked(resetDb).mockResolvedValue(undefined);
    jest.mocked(startTemporaryFileCleanup).mockReset().mockReturnValue(jest.fn().mockResolvedValue(undefined));
    jest.spyOn(AuthService.prototype, 'initialize').mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await running?.close();
    if (occupying) await new Promise<void>((done) => occupying!.close(() => done()));
    running = undefined;
    occupying = undefined;
    jest.restoreAllMocks();
    for (const key of ['PORT', 'HOST', 'STATIC_DIRECTORY', 'VIDEO_UPLOAD_LIMIT_BYTES', 'THUMBNAIL_UPLOAD_LIMIT_BYTES', 'JWT_TTL_SECONDS']) {
      if (environment[key] === undefined) delete process.env[key];
      else process.env[key] = environment[key];
    }
    await rm(directory, { recursive: true, force: true });
  });

  test('initializes adapters and auth before listening, serves static content and closes once', async () => {
    running = await startServer({ port: 0, host: '127.0.0.1', staticDirectory: directory });
    await request(running.server).get('/').expect(200, 'VideoVault');
    for (let i = 0; i < 3; i++) {
      await request(running.server)
        .get('/bootstrap')
        .expect('Cache-Control', 'no-store')
        .expect(200, { version: 1, instanceSalt: 'ab'.repeat(32) });
    }
    expect(ensureInstanceSalt).toHaveBeenCalledWith();
    expect(ensureInstanceSalt).toHaveBeenCalledTimes(1);
    expect(jest.mocked(ensureInstanceSalt).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(loadDb).mock.invocationCallOrder[0]);
    expect(loadDb).toHaveBeenCalledTimes(1);
    expect(loadStorage).toHaveBeenCalledTimes(1);
    expect(AuthService.prototype.initialize).toHaveBeenCalledTimes(1);
    const first = running.close();
    const second = running.close();
    expect(second).toBe(first);
    await first;
    expect(resetDb).toHaveBeenCalledTimes(1);
    expect(resetStorage).toHaveBeenCalledTimes(1);
    expect(running.server.listening).toBe(false);
    expect(startTemporaryFileCleanup).toHaveBeenCalledWith({ logger: expect.objectContaining({ info: expect.any(Function), error: expect.any(Function) }) });
    expect(jest.mocked(startTemporaryFileCleanup).mock.results[0].value).toHaveBeenCalledTimes(1);
  });

  test('propagates database shutdown failures after stopping the HTTP server and cleanup job', async () => {
    const active = await startServer({ port: 0, host: '127.0.0.1', staticDirectory: directory });
    const error = new Error('Database close failed');
    jest.mocked(resetDb).mockRejectedValueOnce(error);
    const first = active.close();
    expect(active.close()).toBe(first);
    await expect(first).rejects.toBe(error);
    expect(active.server.listening).toBe(false);
    expect(jest.mocked(startTemporaryFileCleanup).mock.results[0].value).toHaveBeenCalledTimes(1);
  });

  test('loads port, host and static directory from the environment', async () => {
    process.env.PORT = '0';
    process.env.HOST = '127.0.0.1';
    process.env.STATIC_DIRECTORY = directory;
    running = await startServer();
    expect((running.server.address() as AddressInfo).address).toBe('127.0.0.1');
    await request(running.server).get('/').expect(200, 'VideoVault');
  });

  test.each([-1, 65536, 1.5, NaN])('rejects invalid port %s before initializing adapters', async (port) => {
    await expect(startServer({ port })).rejects.toThrow(RangeError);
    expect(loadDb).not.toHaveBeenCalled();
    expect(startTemporaryFileCleanup).not.toHaveBeenCalled();
  });

  test.each(['instanceSalt', 'db', 'storage', 'auth'] as const)('cleans up resources after %s initialization fails', async (step) => {
    const error = new Error('Initialization failed');
    if (step === 'instanceSalt') jest.mocked(ensureInstanceSalt).mockRejectedValueOnce(error);
    if (step === 'db') jest.mocked(loadDb).mockRejectedValueOnce(error);
    if (step === 'storage') jest.mocked(loadStorage).mockRejectedValueOnce(error);
    if (step === 'auth') jest.mocked(AuthService.prototype.initialize).mockRejectedValueOnce(error);

    await expect(startServer({ port: 0 })).rejects.toBe(error);

    expect(resetDb).toHaveBeenCalledTimes(1);
    expect(resetStorage).toHaveBeenCalledTimes(1);
    expect(startTemporaryFileCleanup).not.toHaveBeenCalled();
  });

  test('keeps the startup error if database cleanup also fails', async () => {
    const error = new Error('Startup failed');
    jest.mocked(loadStorage).mockRejectedValueOnce(error);
    jest.mocked(resetDb).mockRejectedValueOnce(new Error('Cleanup failed'));

    await expect(startServer({ port: 0 })).rejects.toBe(error);
  });

  test('validates the configured JWT lifetime', async () => {
    process.env.JWT_TTL_SECONDS = '0';

    await expect(startServer({ port: 0 })).rejects.toThrow(RangeError);
    expect(resetDb).toHaveBeenCalledTimes(1);
  });

  test('propagates a listen failure and closes initialized resources', async () => {
    occupying = createServer();
    await new Promise<void>((done) => occupying!.listen(0, '127.0.0.1', done));
    await expect(startServer({ port: (occupying.address() as AddressInfo).port, host: '127.0.0.1' })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(resetDb).toHaveBeenCalledTimes(1);
  });

  test('rejects invalid upload limits from the environment without opening a servcr', async () => {
    process.env.VIDEO_UPLOAD_LIMIT_BYTES = '0';
    await expect(startServer({ port: 0 })).rejects.toThrow(RangeError);
    expect(resetDb).toHaveBeenCalledTimes(1);
  });
});
