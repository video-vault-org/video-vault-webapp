import { createServer } from 'node:http';

jest.mock('@/server', () => ({ startServer: jest.fn() }));

describe('backend entrypoint', () => {
  const exitCode = process.exitCode;

  beforeEach(() => {
    jest.resetModules();

    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const originalOnce = process.once.bind(process);

    jest.spyOn(process, 'once').mockImplementation((event, listener) => (event === 'SIGINT' || event === 'SIGTERM' ? process : originalOnce(event, listener)));
  });

  afterEach(() => {
    process.exitCode = exitCode;
    jest.restoreAllMocks();
  });

  test.each(['SIGINT', 'SIGTERM'])('starts the server and closes it on %s', async (signal) => {
    const server = createServer();
    const close = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(server, 'address').mockReturnValue({ port: 3000, family: 'IPv4', address: '127.0.0.1' });
    // resetModules provides a fresh mocked server module to the entrypoint.
    const module = await import('@/server');
    jest.mocked(module.startServer).mockResolvedValue({ server, close });
    await import('@/index');
    const listener = jest.mocked(process.once).mock.calls.find(([event]) => event === signal)![1];
    listener();
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('reports startup failure with a failing exit status', async () => {
    const module = await import('@/server');
    jest.mocked(module.startServer).mockRejectedValueOnce(new Error('Cannot initialize'));
    await import('@/index');
    expect(process.exitCode).toBe(1);
  });

  test('reports shutdown failure with a failing exit status', async () => {
    const module = await import('@/server');
    const server = createServer();
    jest.mocked(module.startServer).mockResolvedValue({ server, close: jest.fn().mockRejectedValueOnce(new Error('Cannot close')) });
    await import('@/index');
    jest
      .mocked(process.once)
      .mock.calls.find(([event]) => event === 'SIGTERM')![1]();
    await Promise.resolve();
    await Promise.resolve();
    expect(process.exitCode).toBe(1);
  });
});
