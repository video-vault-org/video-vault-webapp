import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgresqlDatabaseAdapter } from '@/db/adapters/PostgresqlDatabaseAdapter';
import { DbItem } from '@/db/types/DbItem';

describe('PostgresDatabaseAdapter', (): void => {
  jest.setTimeout(60_000);

  let postgresContainer: null | StartedPostgreSqlContainer = null;
  let db: null | PostgresqlDatabaseAdapter = null;
  let host = '';
  let port = 0;
  let user = '';
  let password = '';

  beforeAll(async () => {
    postgresContainer = await new PostgreSqlContainer('postgres:18.1').withDatabase('video-vault').start();
    host = postgresContainer.getHost();
    port = postgresContainer.getPort();
    user = postgresContainer.getUsername();
    password = postgresContainer.getPassword();
  });

  beforeEach(async () => {
    db = new PostgresqlDatabaseAdapter({ host, port, database: 'video-vault', user, password });
  });

  afterEach(async () => {
    await db?.close();
  });

  afterAll(async () => {
    await db?.close();
    await postgresContainer?.stop();
  });

  test('PostgresqlDatabaseAdapter->constructor loads db correctly.', async () => {
    const newDb = new PostgresqlDatabaseAdapter({ host, port, database: 'video-vault', user, password });

    expect(newDb.getConf()).toEqual([host, port, 'video-vault', user, password]);
    expect(newDb.getClient()?.host).toEqual(host);
  });

  test('PostgresqlDatabaseAdapter->open connects to db.', async (): Promise<void> => {
    await db?.open();

    expect(db?.isConnected()).toBe(true);
  });

  test('PostgresqlDatabaseAdapter->close disconnects from db.', async (): Promise<void> => {
    await db?.open();

    await db?.close();

    expect(db?.isConnected()).toBe(false);
  });

  test('PostgresqlDatabaseAdapter->init initializes table correctly.', async (): Promise<void> => {
    await db?.open();

    await db?.init({ table: 'test_', fields: { testStr: 'string', testDate: 'Date' }, key: '' });

    try {
      const res = await db?.getClient().query('SELECT * FROM test_');
      expect(res?.rowCount).toEqual(0);
      expect(res?.fields.at(0)?.name).toEqual('testStr');
      expect(res?.fields.at(0)?.dataTypeID).toEqual(25);
      expect(res?.fields.at(1)?.name).toEqual('testDate');
      expect(res?.fields.at(1)?.dataTypeID).toEqual(1184);
    } catch (ex: unknown) {
      expect(ex).toBeUndefined();
    }
  });

  describe('queries', () => {
    const testItem: DbItem = { testPropStr: 'A', testPropNo: 42, testPropBool: false, testPropDate: new Date(0), created: new Date(0) };

    beforeEach(async (): Promise<void> => {
      await db?.open();
      await db?.getClient().query('DROP TABLE IF EXISTS test_').catch();
      await db?.init({
        table: 'test_',
        fields: { testPropStr: 'string', testPropNo: 'number', testPropBool: 'boolean', testPropDate: 'Date', created: 'Date' },
        key: ''
      });
    });

    test('PostgresqlDatabaseAdapter->add adds item.', async (): Promise<void> => {
      await db?.add('test_', testItem);

      const res = await db?.getClient().query<DbItem>('SELECT * FROM test_');
      expect(res?.rowCount).toBe(1);
      expect(res?.rows?.at(0)).toEqual(testItem);
    });

    test('PostgresqlDatabaseAdapter->update updates item, without key change.', async (): Promise<void> => {
      await db?.add('test_', testItem);
      const update = { testPropNo: 23, testPropBool: true };

      const count = await db?.update('test_', 'testPropStr', 'A', update);

      const res = await db?.getClient().query<DbItem>('SELECT * FROM test_');
      expect(res?.rowCount).toBe(1);
      expect(res?.rows?.at(0)).toEqual({ ...testItem, ...update });
      expect(count).toBe(1);
    });

    test('PostgresqlDatabaseAdapter->update updates item, with key change.', async (): Promise<void> => {
      await db?.add('test_', testItem);
      const update = { testPropStr: 'B', testPropBool: true };

      await db?.update('test_', 'testPropStr', 'A', update);

      const res = await db?.getClient().query<DbItem>('SELECT * FROM test_');
      expect(res?.rowCount).toBe(1);
      expect(res?.rows?.at(0)).toEqual({ ...testItem, ...update });
    });

    test('PostgresqlDatabaseAdapter->update updates items.', async (): Promise<void> => {
      await db?.add('test_', testItem);
      await db?.add('test_', { ...testItem, testPropNo: 0 });
      const update = { testPropNo: 23 };

      const count = await db?.update('test_', 'testPropStr', 'A', update);

      const res = await db?.getClient().query<DbItem>('SELECT * FROM test_');
      expect(res?.rowCount).toBe(2);
      expect(res?.rows?.at(0)).toEqual({ ...testItem, ...update });
      expect(res?.rows?.at(1)).toEqual({ ...testItem, ...update });
      expect(count).toBe(2);
    });

    test('PostgresqlDatabaseAdapter->update updates no items.', async (): Promise<void> => {
      await db?.add('test_', testItem);
      const update = { testPropNo: 23 };

      const count = await db?.update('test_', 'testPropStr', 'nope', update);

      const res = await db?.getClient().query<DbItem>('SELECT * FROM test_');
      expect(res?.rowCount).toBe(1);
      expect(res?.rows?.at(0)).toEqual(testItem);
      expect(count).toBe(0);
    });

    test('PostgresqlDatabaseAdapter->exists returns true if item exists.', async (): Promise<void> => {
      await db?.add('test_', testItem);

      const existsA = await db?.exists('test_', 'testPropStr', 'A');
      const existsB = await db?.exists('test_', 'testPropStr', 'B');

      expect(existsA).toBe(true);
      expect(existsB).toBe(false);
    });

    test('PostgresqlDatabaseAdapter->delete deletes item.', async (): Promise<void> => {
      const otherItem = { ...testItem, testPropStr: 'B' };
      await db?.add('test_', testItem);
      await db?.add('test_', otherItem);

      const count = await db?.delete('test_', 'testPropStr', 'A');

      const res = await db?.getClient().query<DbItem>('SELECT * FROM test_');
      expect(res?.rowCount).toBe(1);
      expect(res?.rows?.at(0)).toEqual(otherItem);
      expect(count).toBe(1);
    });

    test('PostgresqlDatabaseAdapter->delete deletes items.', async (): Promise<void> => {
      const otherItem = { ...testItem, testPropNo: 5 };
      await db?.add('test_', testItem);
      await db?.add('test_', otherItem);

      const count = await db?.delete('test_', 'testPropStr', 'A');

      const res = await db?.getClient().query<DbItem>('SELECT * FROM test_');
      expect(res?.rowCount).toBe(0);
      expect(count).toBe(2);
    });

    test('PostgresqlDatabaseAdapter->delete deletes no items.', async (): Promise<void> => {
      await db?.add('test_', testItem);

      const count = await db?.delete('test_', 'testPropStr', 'nope');

      const res = await db?.getClient().query<DbItem>('SELECT * FROM test_');
      expect(res?.rowCount).toBe(1);
      expect(count).toBe(0);
    });

    test('PostgresqlDatabaseAdapter->findOne finds one.', async (): Promise<void> => {
      await db?.add('test_', testItem);

      const item = await db?.findOne('test_', 'testPropStr', 'A');

      expect(item).toEqual(testItem);
    });

    test('PostgresqlDatabaseAdapter->findMany filters and sorts by creation date before paging', async () => {
      const items = [
        { ...testItem, created: new Date(10) },
        { ...testItem, testPropStr: 'B', created: new Date(40) },
        { ...testItem, created: new Date(30) },
        { ...testItem, created: new Date(20) }
      ];
      for (const item of items) {
        await db?.add('test_', item);
      }

      expect(await db?.findMany('test_', 'testPropStr', 'A', {})).toEqual([items[2], items[3], items[0]]);
      expect(await db?.findMany('test_', 'testPropStr', 'A', { skip: 1, get: 1 })).toEqual([items[3]]);
      expect(await db?.findMany('test_', 'testPropStr', 'A', { get: 0 })).toEqual([]);
    });

    test('PostgresqlDatabaseAdapter->findAll returns all rows', async () => {
      const items = [testItem, { ...testItem, testPropBool: true }, { ...testItem, testPropNo: 23 }];
      for (const item of items) {
        await db?.add('test_', item);
      }

      const result = await db?.findAll('test_');

      expect(result).toHaveLength(items.length);
      expect(result).toEqual(expect.arrayContaining(items));
    });

    test('PostgresqlDatabaseAdapter->findAllSince finds all, last modified since.', async (): Promise<void> => {
      await db?.init({ table: 'test__', key: 'testPropStr', fields: { testPropStr: 'string', lastModified: 'Date' } });
      await db?.add('test__', { testPropStr: 'A', lastModified: new Date(5) });
      await db?.add('test__', { testPropStr: 'B', lastModified: new Date(9) });
      await db?.add('test__', { testPropStr: 'C', lastModified: new Date(9) });

      const items = await db?.findAllSince('test__', new Date(7));

      expect(items?.length).toBe(2);
      expect(items?.at(0)).toEqual({ testPropStr: 'B', lastModified: new Date(9) });
      expect(items?.at(1)).toEqual({ testPropStr: 'C', lastModified: new Date(9) });
    });

    test('PostgresqlDatabaseAdapter->findAllSince finds nothing, if no lastModified column.', async (): Promise<void> => {
      await db?.init({ table: 'test___', key: 'testPropStr', fields: { testPropStr: 'string' } });
      await db?.add('test___', { testPropStr: 'A' });
      await db?.add('test___', { testPropStr: 'B' });

      const items = await db?.findAllSince('test___', new Date(7));

      expect(items?.length).toBe(0);
    });
  });
});
