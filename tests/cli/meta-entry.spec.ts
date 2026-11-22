jest.mock('@/util/instanceSalt', () => ({ ensureInstanceSalt: jest.fn().mockResolvedValue('ab'.repeat(32)) }));

jest.mock('@/cli/meta', () => ({ initializeMetaConfig: jest.fn() }));

describe('metadata CLI entrypoint', () => {
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

  test('ensures the salt before running metadata initialization', async () => {
    const meta = await import('@/cli/meta');
    const salt = await import('@/util/instanceSalt');
    jest.mocked(meta.initializeMetaConfig).mockResolvedValueOnce(undefined);
    await import('@/initialize-meta');
    await new Promise(setImmediate);
    expect(salt.ensureInstanceSalt).toHaveBeenCalledWith();
    expect(meta.initializeMetaConfig).toHaveBeenCalledWith();
    expect(jest.mocked(salt.ensureInstanceSalt).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(meta.initializeMetaConfig).mock.invocationCallOrder[0]);
    expect(console.log).toHaveBeenCalledWith('Metadata configuration initialization completed');
    expect(console.error).not.toHaveBeenCalled();
  });

  test.each(['salt', 'meta'])('reports %s initialization errors without logging their values', async (step) => {
    const meta = await import('@/cli/meta');
    const salt = await import('@/util/instanceSalt');
    const error = new Error('private-value');
    if (step === 'salt') jest.mocked(salt.ensureInstanceSalt).mockRejectedValueOnce(error);
    else jest.mocked(meta.initializeMetaConfig).mockRejectedValueOnce(error);
    await import('@/initialize-meta');
    await new Promise(setImmediate);
    expect(process.exitCode).toBe(1);
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('Metadata configuration initialization failed: check answers, salt file and configuration file permissions');
    expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain('private-value');
    if (step === 'salt') expect(meta.initializeMetaConfig).not.toHaveBeenCalled();
  });
});
