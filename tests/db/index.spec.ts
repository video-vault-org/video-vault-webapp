import fs from 'fs/promises';
import { saveConfig, loadDb, resetDb } from '@/db';
import mockFS from 'mock-fs';
import { exists } from '#/util';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { DatabaseConfig } from '@/db/types/DatabaseConfig';
import { MongoDatabaseAdapter } from '@/db/adapters/MongoDatabaseAdapter';
import { PostgresqlDatabaseAdapter } from '@/db/adapters/PostgresqlDatabaseAdapter';
import { PostgresqlDatabaseConf } from '@/db/types/PostgresqlDatabaseConf';

jest.mock('pg', () => {
  return {
    Client: class {
      public readonly host: string;
      public readonly port: number;
      public readonly database: string;
      public readonly user: string | undefined;
      public readonly password: string | undefined;

      public constructor({ host, port, database, user, password }: PostgresqlDatabaseConf) {
        this.host = host;
        this.port = port;
        this.database = database;
        this.user = user;
        this.password = password;
      }

      public async connect() {}

      public async end() {}

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      public async query(_query: string) {}
    }
  };
});

describe('db', (): void => {
  afterEach(async (): Promise<void> => {
    mockFS.restore();
    await resetDb();
  });

  test('saveConfig saves config', async () => {
    mockFS({});

    await saveConfig({ type: 'in-memory' });

    expect(await exists('./conf/db.json')).toBe(true);
    expect(JSON.parse((await fs.readFile('./conf/db.json'))?.toString('utf8'))).toEqual({ type: 'in-memory' });
  });

  test('loadDb loads in-memory db correctly', async () => {
    mockFS({ './conf': { 'db.json': JSON.stringify({ type: 'in-memory' }) } });

    const db = await loadDb();

    expect(db).toBeInstanceOf(InMemoryDatabaseAdapter);
    expect((db as InMemoryDatabaseAdapter).isOpen()).toBe(true);
    expect(Object.keys((db as InMemoryDatabaseAdapter).getMemory())).toEqual(['comment', 'user_', 'video']);
  });

  test('loadDb loads mongo db correctly', async () => {
    const config: DatabaseConfig = { type: 'mongo', conf: { url: 'mongodb://localhost:27017/video-vault' } };
    mockFS({ './conf': { 'db.json': JSON.stringify(config) } });

    const db = await loadDb();

    expect(db).toBeInstanceOf(MongoDatabaseAdapter);
    expect((db as MongoDatabaseAdapter).getConf()).toEqual([config.conf.url, '', '']);
  });

  test('loadDb loads postgresql db correctly', async () => {
    const config: DatabaseConfig = { type: 'postgresql', conf: { host: '127.0.0.1', port: 5432, database: 'video-vault' } };
    mockFS({ './conf': { 'db.json': JSON.stringify(config) } });

    const db = await loadDb();

    expect(db).toBeInstanceOf(PostgresqlDatabaseAdapter);
    expect((db as PostgresqlDatabaseAdapter).getConf()).toEqual([config.conf.host, config.conf.port, config.conf.database, undefined, undefined]);
  });
});
