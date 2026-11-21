import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';

jest.mock('@/util/pepper', () => ({ ensurePepper: jest.fn().mockResolvedValue('ab'.repeat(32)) }));

jest.mock('@/db', () => ({ loadDb: jest.fn(), resetDb: jest.fn() }));
jest.mock('@/cli/admin', () => ({ readAdminInput: jest.fn(), initializeAdmin: jest.fn() }));

describe('admin CLI entrypoint', () => {
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

  test('prompts for credentials, initializes the admin and closes the database without printing credentials', async () => {
    const db = await import('@/db');
    const admin = await import('@/cli/admin');
    const adapter = new InMemoryDatabaseAdapter();
    const input = { username: 'alice', displayName: 'Alice', password: 'secret-input' };
    jest.mocked(db.loadDb).mockResolvedValue(adapter);
    jest.mocked(db.resetDb).mockResolvedValue(undefined);
    jest.mocked(admin.readAdminInput).mockResolvedValue(input);
    jest.mocked(admin.initializeAdmin).mockResolvedValue(undefined);
    await import('@/initialize-admin');
    await new Promise(setImmediate);
    const pepper = await import('@/util/pepper');
    expect(pepper.ensurePepper).toHaveBeenCalledWith();
    expect(jest.mocked(pepper.ensurePepper).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(admin.readAdminInput).mock.invocationCallOrder[0]);
    expect(admin.readAdminInput).toHaveBeenCalledWith();
    expect(admin.initializeAdmin).toHaveBeenCalledWith(adapter, input);
    expect(db.resetDb).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith('Initial admin created');
    expect(console.error).not.toHaveBeenCalled();
  });

  test.each(['pepper', 'input', 'database', 'creation'] as const)('returns a failing status and sanitized message after %s failure', async (step) => {
    const db = await import('@/db');
    const admin = await import('@/cli/admin');
    jest.mocked(db.loadDb).mockResolvedValue(new InMemoryDatabaseAdapter());
    jest.mocked(db.resetDb).mockResolvedValue(undefined);
    jest.mocked(admin.readAdminInput).mockResolvedValue({ username: 'alice', displayName: 'Alice', password: 'secret-input' });
    jest.mocked(admin.initializeAdmin).mockResolvedValue(undefined);
    const error = new Error('secret-input');
    if (step === 'pepper') jest.mocked((await import('@/util/pepper')).ensurePepper).mockRejectedValueOnce(error);
    if (step === 'input') jest.mocked(admin.readAdminInput).mockRejectedValueOnce(error);
    if (step === 'database') jest.mocked(db.loadDb).mockRejectedValueOnce(error);
    if (step === 'creation') jest.mocked(admin.initializeAdmin).mockRejectedValueOnce(error);
    await import('@/initialize-admin');
    await new Promise(setImmediate);
    expect(process.exitCode).toBe(1);
    expect(db.resetDb).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
    expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain('secret-input');
  });
});
