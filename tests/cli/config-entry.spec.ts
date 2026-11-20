jest.mock('@/cli/config', () => ({ initializeConfig: jest.fn() }));

describe('configuration CLI entrypoint', () => {
  const exitCode = process.exitCode;
  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.exitCode = exitCode;
    jest.restoreAllMocks();
  });

  test('runs initialization and reports success without printing configuration values', async () => {
    const config = await import('@/cli/config');
    jest.mocked(config.initializeConfig).mockResolvedValueOnce(undefined);
    await import('@/initialize-config');
    await new Promise(setImmediate);
    expect(config.initializeConfig).toHaveBeenCalledWith();
    expect(console.log).toHaveBeenCalledWith('Database and storage configuration saved');
    expect(console.error).not.toHaveBeenCalled();
  });

  test('reports a failing exit status without leaking credentials or stack traces', async () => {
    const config = await import('@/cli/config');
    jest.mocked(config.initializeConfig).mockRejectedValueOnce(new Error('secret-credential'));
    await import('@/initialize-config');
    await new Promise(setImmediate);
    expect(process.exitCode).toBe(1);
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('Configuration initialization failed: check answers and configuration file permissions');
  });
});
