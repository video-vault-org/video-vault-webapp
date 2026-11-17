import { readFile, writeFile } from 'fs/promises';
import { loadConfig, loadDb, resetDb, saveConfig } from '@/db';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { MongoDatabaseAdapter } from '@/db/adapters/MongoDatabaseAdapter';
import { PostgresqlDatabaseAdapter } from '@/db/adapters/PostgresqlDatabaseAdapter';
import { SQLiteDatabaseAdapter } from '@/db/adapters/SQLiteDatabaseAdapter';
import { DynamoDBDatabaseAdapter } from '@/db/adapters/DynamoDBDatabaseAdapter';
import { DatabaseConfig } from '@/db/config/DatabaseConfig';

function mockAdapter() {
  return jest.fn().mockImplementation(() => ({
    open: jest.fn().mockResolvedValue(undefined),
    initialize: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined)
  }));
}

jest.mock('fs/promises', () => ({ readFile: jest.fn(), writeFile: jest.fn() }));
jest.mock('@/db/adapters/InMemoryDatabaseAdapter', () => ({ InMemoryDatabaseAdapter: mockAdapter() }));
jest.mock('@/db/adapters/MongoDatabaseAdapter', () => ({ MongoDatabaseAdapter: mockAdapter() }));
jest.mock('@/db/adapters/PostgresqlDatabaseAdapter', () => ({ PostgresqlDatabaseAdapter: mockAdapter() }));
jest.mock('@/db/adapters/SQLiteDatabaseAdapter', () => ({ SQLiteDatabaseAdapter: mockAdapter() }));
jest.mock('@/db/adapters/DynamoDBDatabaseAdapter', () => ({ DynamoDBDatabaseAdapter: mockAdapter() }));

describe('db', () => {
  const path = './conf/db.json';
  const inMemory: DatabaseConfig = { type: 'in-memory' };
  const mongo: DatabaseConfig = { type: 'mongo', conf: { url: 'mongodb://localhost/video-vault', user: 'test', pass: 'test' } };
  const postgresql: DatabaseConfig = { type: 'postgresql', conf: { host: 'localhost', port: 5432, database: 'video-vault-test' } };
  const sqlite: DatabaseConfig = { type: 'sqlite', conf: { filePath: ':memory:' } };
  const dynamodb: DatabaseConfig = { type: 'dynamodb', conf: { region: 'eu-central-1', tablePrefix: 'vault-' } };
  const read = jest.mocked(readFile);
  const write = jest.mocked(writeFile);

  beforeEach(() => {
    read.mockReset();
    write.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await resetDb();
  });

  describe('loadConfig', () => {
    test.each([inMemory, mongo, postgresql, sqlite, dynamodb])('reads the $type configuration', async (config) => {
      read.mockResolvedValue(JSON.stringify(config));

      expect(await loadConfig()).toEqual(config);
      expect(read).toHaveBeenCalledWith(path, 'utf8');
    });

    test.each(['', '{'])('returns null for empty or malformed JSON (%j)', async (contents) => {
      read.mockResolvedValue(contents);

      expect(await loadConfig()).toBeNull();
    });

    test.each(['ENOENT', 'EACCES'])('returns null when reading fails with %s', async (code) => {
      read.mockRejectedValue(Object.assign(new Error(code), { code }));

      expect(await loadConfig()).toBeNull();
    });
  });

  describe('loadDb', () => {
    test.each([
      { config: inMemory, adapter: InMemoryDatabaseAdapter, args: [] },
      { config: mongo, adapter: MongoDatabaseAdapter, args: [mongo.conf] },
      { config: postgresql, adapter: PostgresqlDatabaseAdapter, args: [postgresql.conf] },
      { config: sqlite, adapter: SQLiteDatabaseAdapter, args: [sqlite.conf] },
      { config: dynamodb, adapter: DynamoDBDatabaseAdapter, args: [dynamodb.conf] }
    ])('constructs and initializes the $config.type adapter', async ({ config, adapter, args }) => {
      read.mockResolvedValue(JSON.stringify(config));

      const db = await loadDb();

      expect(read).toHaveBeenCalledWith(path, 'utf8');
      expect(adapter).toHaveBeenCalledTimes(1);
      expect(adapter).toHaveBeenCalledWith(...args);
      expect(db).toBe(jest.mocked(adapter).mock.results[0].value);
      expect(db.open).toHaveBeenCalledTimes(1);
      expect(db.initialize).toHaveBeenCalledTimes(1);
      expect(jest.mocked(db.open).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(db.initialize).mock.invocationCallOrder[0]);
    });

    test('reuses the cached adapter without rereading the configuration or reopening it', async () => {
      read.mockResolvedValueOnce(JSON.stringify(inMemory)).mockResolvedValueOnce(JSON.stringify(sqlite));

      const db = await loadDb();
      expect(await loadDb()).toBe(db);

      expect(read).toHaveBeenCalledTimes(1);
      expect(db.open).toHaveBeenCalledTimes(1);
      expect(db.initialize).toHaveBeenCalledTimes(1);
      expect(SQLiteDatabaseAdapter).not.toHaveBeenCalled();
    });

    test('allows a retry after initialization fails and closes the failed adapter', async () => {
      read.mockResolvedValue(JSON.stringify(dynamodb));
      const error = new Error('CreateTable denied');
      const failed = { open: jest.fn().mockResolvedValue(undefined), initialize: jest.fn().mockRejectedValue(error), close: jest.fn().mockResolvedValue(undefined) };
      jest.mocked(DynamoDBDatabaseAdapter).mockImplementationOnce(() => failed as unknown as DynamoDBDatabaseAdapter);

      await expect(loadDb()).rejects.toBe(error);
      expect(failed.close).toHaveBeenCalledTimes(1);
      const recovered = await loadDb();
      expect(recovered).not.toBe(failed);
      expect(recovered.initialize).toHaveBeenCalledTimes(1);
    });

    test('propagates configuration read errors', async () => {
      const error = Object.assign(new Error('Config not found'), { code: 'ENOENT' });
      read.mockRejectedValue(error);

      await expect(loadDb()).rejects.toBe(error);
    });

    test('rejects malformed JSON before opening an adapter', async () => {
      read.mockResolvedValue('{');

      await expect(loadDb()).rejects.toThrow(SyntaxError);
      expect(InMemoryDatabaseAdapter).not.toHaveBeenCalled();
    });
  });

  describe('saveConfig', () => {
    test('writes JSON, closes the cached adapter and uses the new configuration afterwards', async () => {
      read.mockResolvedValueOnce(JSON.stringify(inMemory)).mockResolvedValueOnce(JSON.stringify(sqlite));
      const previous = await loadDb();

      await saveConfig(sqlite);

      expect(write).toHaveBeenCalledWith(path, JSON.stringify(sqlite, null, 4), 'utf8');
      expect(previous.close).toHaveBeenCalledTimes(1);
      expect(write.mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(previous.close).mock.invocationCallOrder[0]);
      const next = await loadDb();
      expect(next).not.toBe(previous);
      expect(SQLiteDatabaseAdapter).toHaveBeenCalledWith(sqlite.conf);
    });

    test('keeps the cached adapter when writing the configuration fails', async () => {
      read.mockResolvedValue(JSON.stringify(inMemory));
      const current = await loadDb();
      const error = new Error('Could not write config');
      write.mockRejectedValueOnce(error);

      await expect(saveConfig(sqlite)).rejects.toBe(error);
      expect(current.close).not.toHaveBeenCalled();
      expect(await loadDb()).toBe(current);
    });
  });

  describe('resetDb', () => {
    test('does nothing when no adapter has been loaded', async () => {
      await expect(resetDb()).resolves.toBeUndefined();
      expect(read).not.toHaveBeenCalled();
    });

    test('closes the cached adapter once and permits reloading', async () => {
      read.mockResolvedValueOnce(JSON.stringify(inMemory)).mockResolvedValueOnce(JSON.stringify(mongo));
      const previous = await loadDb();

      await resetDb();
      await resetDb();

      expect(previous.close).toHaveBeenCalledTimes(1);
      expect(await loadDb()).not.toBe(previous);
      expect(MongoDatabaseAdapter).toHaveBeenCalledWith(mongo.conf);
    });
  });
});
