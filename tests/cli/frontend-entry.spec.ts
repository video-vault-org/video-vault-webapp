jest.mock('@/util/instanceSalt', () => ({ ensureInstanceSalt: jest.fn().mockResolvedValue('ab'.repeat(32)) }));

jest.mock('@/cli/frontend', () => ({ initializeFrontendConfig: jest.fn() }));

describe('frontend CLI entrypoint', () => {
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
    const config = await import('@/cli/frontend');
    jest.mocked(config.initializeFrontendConfig).mockResolvedValueOnce(undefined);
    await import('@/initialize-frontend');
    await new Promise(setImmediate);
    const instanceSalt = await import('@/util/instanceSalt');
    expect(instanceSalt.ensureInstanceSalt).toHaveBeenCalledWith();
    expect(jest.mocked(instanceSalt.ensureInstanceSalt).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(config.initializeFrontendConfig).mock.invocationCallOrder[0]);
    expect(config.initializeFrontendConfig).toHaveBeenCalledWith();
    expect(console.log).toHaveBeenCalledWith('Frontend configuration initialization completed');
    expect(console.error).not.toHaveBeenCalled();
  });

  test('reports a failing exit status without leaking credentials or stack traces', async () => {
    const config = await import('@/cli/frontend');
    jest.mocked(config.initializeFrontendConfig).mockRejectedValueOnce(new Error('secret-credential'));
    await import('@/initialize-frontend');
    await new Promise(setImmediate);
    expect(process.exitCode).toBe(1);
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('Frontend configuration initialization failed: check image sets, answers, instance salt file and configuration file permissions');
  });

  test('stops before prompting when instance salt initialization fails', async () => {
    const instanceSalt = await import('@/util/instanceSalt');
    const config = await import('@/cli/frontend');
    jest.mocked(instanceSalt.ensureInstanceSalt).mockRejectedValueOnce(new Error('private-value'));
    await import('@/initialize-frontend');
    await new Promise(setImmediate);
    expect(config.initializeFrontendConfig).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain('private-value');
  });
});
