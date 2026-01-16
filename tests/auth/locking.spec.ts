import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { countAttempt, handleLocking, resetAttempts, THRESHOLD, TTL_MAX, TTL_MIN } from '@/auth/locking';

const username = 'testUser';

const mocked_db = new InMemoryDatabaseAdapter();

jest.mock('@/db', () => {
  return {
    async loadDb() {
      return mocked_db;
    }
  };
});

describe('locking', () => {
  beforeAll(() => {
    mocked_db.getMemory().lock = {
      name: 'lock',
      key: '',
      fields: {},
      items: []
    };
  });

  beforeEach(async (): Promise<void> => {
    jest.useFakeTimers();
    mocked_db.getMemory().lock.items = [];
  });

  afterEach(async (): Promise<void> => {
    jest.useRealTimers();
  });

  test('countAttempt counts attempt, empty before.', async (): Promise<void> => {
    jest.setSystemTime(new Date(42));

    await countAttempt(username);

    expect(mocked_db.getMemory().lock?.items?.at(0)?.username).toBe(username);
    expect(mocked_db.getMemory().lock?.items?.at(0)?.attempts).toBe(1);
    expect(mocked_db.getMemory().lock?.items?.at(0)?.lastAttempt).toEqual(new Date(42));
  });

  test('countAttempt counts attempt, given before, 1.', async (): Promise<void> => {
    jest.setSystemTime(new Date(42));
    mocked_db.getMemory().lock?.items.push({ username, attempts: 1, lastAttempt: 0 });

    await countAttempt(username);

    expect(mocked_db.getMemory().lock?.items?.at(0)?.username).toBe(username);
    expect(mocked_db.getMemory().lock?.items?.at(0)?.attempts).toBe(2);
    expect(mocked_db.getMemory().lock?.items?.at(0)?.lastAttempt).toEqual(new Date(42));
  });

  test('resetAttempts resets attempts.', async (): Promise<void> => {
    jest.setSystemTime(new Date(42));
    mocked_db.getMemory().lock?.items.push({ username, attempts: 1, lastAttempt: new Date(0) });

    await resetAttempts(username);

    expect(mocked_db.getMemory().lock?.items.length).toBe(0);
  });

  test('handleLocking returns false, if attempts < threshold.', async (): Promise<void> => {
    jest.setSystemTime(new Date(42));
    mocked_db.getMemory().lock?.items.push({ username, attempts: 1, lastAttempt: new Date(0) });

    const locked = await handleLocking(username);

    expect(locked).toBe(false);
  });

  test('handleLocking returns false, if lock is expired, smallest TTL.', async (): Promise<void> => {
    jest.setSystemTime(new Date(TTL_MIN + 1));
    mocked_db.getMemory().lock?.items.push({ username, attempts: 5, lastAttempt: new Date(0) });

    const locked = await handleLocking(username);

    expect(locked).toBe(false);
  });

  test('handleLocking returns true, if lock is active, also updates lastAttempt, smallest TTL.', async (): Promise<void> => {
    jest.setSystemTime(new Date(TTL_MIN - 500));
    mocked_db.getMemory().lock?.items.push({ username, attempts: 5, lastAttempt: new Date(0) });

    const locked = await handleLocking(username);

    expect(locked).toBe(true);
    expect(mocked_db.getMemory().lock?.items?.at(0)?.lastAttempt).toEqual(new Date(TTL_MIN - 500));
  });

  test('handleLocking returns false, if lock is expired, medium TTL.', async (): Promise<void> => {
    const factor = 2 ** (8 - THRESHOLD);
    const ttl = TTL_MIN * factor;
    jest.setSystemTime(new Date(ttl + 1));
    mocked_db.getMemory().lock?.items.push({ username, attempts: 8, lastAttempt: new Date(0) });

    const locked = await handleLocking(username);

    expect(locked).toBe(false);
  });

  test('handleLocking returns true, if lock is active, also updates lastAttempt, medium TTL.', async (): Promise<void> => {
    const factor = 2 ** (8 - THRESHOLD);
    const ttl = TTL_MIN * factor;
    jest.setSystemTime(new Date(ttl - 500));
    mocked_db.getMemory().lock?.items.push({ username, attempts: 8, lastAttempt: new Date(0) });

    const locked = await handleLocking(username);

    expect(locked).toBe(true);
    expect(mocked_db.getMemory().lock?.items?.at(0)?.lastAttempt).toEqual(new Date(ttl - 500));
  });

  test('handleLocking returns false, if lock is expired, biggest TTL.', async (): Promise<void> => {
    jest.setSystemTime(new Date(TTL_MAX + 1));
    mocked_db.getMemory().lock?.items.push({ username, attempts: 12, lastAttempt: new Date(0) });

    const locked = await handleLocking(username);

    expect(locked).toBe(false);
  });

  test('handleLocking returns true, if lock is active, also updates lastAttempt, biggest TTL.', async (): Promise<void> => {
    jest.setSystemTime(new Date(TTL_MAX - 500));
    mocked_db.getMemory().lock?.items.push({ username, attempts: 12, lastAttempt: new Date(0) });

    const locked = await handleLocking(username);

    expect(locked).toBe(true);
    expect(mocked_db.getMemory().lock?.items?.at(0)?.lastAttempt).toEqual(new Date(TTL_MAX - 500));
  });
});
