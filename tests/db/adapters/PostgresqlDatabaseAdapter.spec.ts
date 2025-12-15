import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgresqlDatabaseAdapter } from '@/db/adapters/PostgresqlDatabaseAdapter';
import { DbItem } from '@/db/types/DbItem';

describe('PostgresDatabaseAdapter', (): void => {
  jest.setTimeout(60000);

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
    const testItem: DbItem = { testPropStr: 'A', testPropNo: 42, testPropBool: false, testPropDate: new Date(0) };

    beforeEach(async (): Promise<void> => {
      await db?.open();
      await db?.getClient().query('DROP TABLE IF EXISTS test_').catch();
      await db?.init({
        table: 'test_',
        fields: { testPropStr: 'string', testPropNo: 'number', testPropBool: 'boolean', testPropDate: 'Date' },
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

      await db?.update('test_', 'testPropStr', 'A', update);

      const res = await db?.getClient().query<DbItem>('SELECT * FROM test_');
      expect(res?.rowCount).toBe(1);
      expect(res?.rows?.at(0)).toEqual({ ...testItem, ...update });
    });

    test('PostgresqlDatabaseAdapter->update updates item, with key change.', async (): Promise<void> => {
      await db?.add('test_', testItem);
      const update = { testPropStr: 'B', testPropBool: true };

      await db?.update('test_', 'testPropStr', 'A', update);

      const res = await db?.getClient().query<DbItem>('SELECT * FROM test_');
      expect(res?.rowCount).toBe(1);
      expect(res?.rows?.at(0)).toEqual({ ...testItem, ...update });
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

      await db?.delete('test_', 'testPropStr', 'A');

      const res = await db?.getClient().query<DbItem>('SELECT * FROM test_');
      expect(res?.rowCount).toBe(1);
      expect(res?.rows?.at(0)).toEqual(otherItem);
    });

    test('PostgresqlDatabaseAdapter->findOne finds one.', async (): Promise<void> => {
      await db?.add('test_', testItem);

      const item = await db?.findOne('test_', 'testPropStr', 'A');

      expect(item).toEqual(testItem);
    });

    test('PostgresqlDatabaseAdapter->findMany finds many, without limit.', async (): Promise<void> => {
      await db?.add('test_', testItem);
      await db?.add('test_', { ...testItem, testPropBool: true });
      await db?.add('test_', { ...testItem, testPropNo: 23 });
      await db?.add('test_', { ...testItem, testPropStr: 'B' });

      const items = await db?.findMany('test_', 'testPropStr', 'A');

      expect(items?.length).toBe(3);
      expect(items?.at(0)).toEqual(testItem);
      expect(items?.at(1)).toEqual({ ...testItem, testPropBool: true });
      expect(items?.at(2)).toEqual({ ...testItem, testPropNo: 23 });
    });

    test('PostgresqlDatabaseAdapter->findMany finds many, with limit.', async (): Promise<void> => {
      await db?.add('test_', testItem);
      await db?.add('test_', { ...testItem, testPropBool: true });
      await db?.add('test_', { ...testItem, testPropNo: 23 });
      await db?.add('test_', { ...testItem, testPropStr: 'B' });

      const items = await db?.findMany('test_', 'testPropStr', 'A', { skip: 1, get: 2 });

      expect(items?.length).toBe(2);
      expect(items?.at(0)).toEqual({ ...testItem, testPropBool: true });
      expect(items?.at(1)).toEqual({ ...testItem, testPropNo: 23 });
    });

    test('PostgresqlDatabaseAdapter->findAll finds all, without limit.', async (): Promise<void> => {
      await db?.add('test_', testItem);
      await db?.add('test_', { ...testItem, testPropBool: true });
      await db?.add('test_', { ...testItem, testPropNo: 23 });

      const items = await db?.findAll('test_');

      expect(items?.length).toBe(3);
      expect(items?.at(0)).toEqual(testItem);
      expect(items?.at(1)).toEqual({ ...testItem, testPropBool: true });
      expect(items?.at(2)).toEqual({ ...testItem, testPropNo: 23 });
    });

    test('PostgresqlDatabaseAdapter->findAll finds all, with limit.', async (): Promise<void> => {
      await db?.add('test_', testItem);
      await db?.add('test_', { ...testItem, testPropBool: true });
      await db?.add('test_', { ...testItem, testPropNo: 23 });

      const items = await db?.findAll('test_', { skip: 1, get: 2 });

      expect(items?.length).toBe(2);
      expect(items?.at(0)).toEqual({ ...testItem, testPropBool: true });
      expect(items?.at(1)).toEqual({ ...testItem, testPropNo: 23 });
    });

    describe('errors', () => {
      test('PostgresqlDatabaseAdapter->delete throws exception correctly.', async (): Promise<void> => {
        await db?.add('test_', testItem);
        let error: Error | null = null;

        await db?.delete('test_', 'testPropStr', 'B').catch((err) => {
          error = err as Error;
        });

        expect(error).not.toBe(null);
        expect((error as unknown as Error).message).toEqual('Item not found in table test_ where testPropStr=B.');
      });

      test('PostgresqlDatabaseAdapter->update throws exception correctly.', async (): Promise<void> => {
        await db?.add('test_', testItem);
        let error: Error | null = null;

        await db?.update('test_', 'testPropStr', 'B', { testPropNo: 5 }).catch((err) => {
          error = err as Error;
        });

        expect(error).not.toBe(null);
        expect((error as unknown as Error).message).toEqual('Item not found in table test_ where testPropStr=B.');
      });
    });
  });
});
