import { MongoDBContainer, StartedMongoDBContainer } from '@testcontainers/mongodb';
import mongoose from 'mongoose';
import { MongoDatabaseAdapter, MongoItem } from '@/db/adapters/MongoDatabaseAdapter';
import { DbItem, DbValue } from '@/db/types/DatabaseAdapter';

const getItem = async function (db: MongoDatabaseAdapter | null, filter: Record<string, DbValue>): Promise<DbItem | null> {
  const collection = db?.getCollections()?.test_;
  const item = await collection?.findOne<MongoItem>(filter ?? {});
  if (!item) {
    return null;
  }
  delete item._id;
  return item as DbItem;
};

describe('MongoDatabaseAdapter', (): void => {
  jest.setTimeout(60000);

  let container: StartedMongoDBContainer | null = null;
  let db: null | MongoDatabaseAdapter = null;
  let url = 'mongodb://localhost:27017/video-vault';

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:6.0.1').start();
    url = `${container.getConnectionString()}/video-vault`;
  });

  afterAll(async () => {
    container?.stop();
  });

  beforeEach(async (): Promise<void> => {
    db = new MongoDatabaseAdapter(url);
  });

  afterEach(async (): Promise<void> => {
    if ('test_' in (db?.getCollections() ?? {})) {
      await db?.getConnection()?.dropCollection('test_');
    }
    await db?.close();
  });

  test('MongoDatabaseAdapter->constructor works correctly, no auth.', async (): Promise<void> => {
    const newDb = new MongoDatabaseAdapter(url);

    expect(newDb.getConf()).toEqual([url, '', '']);
  });

  test('MongoDatabaseAdapter->constructor works correctly, with auth.', async (): Promise<void> => {
    const newDb = new MongoDatabaseAdapter(url, 'user', 'pass');

    expect(newDb.getConf()).toEqual([url, 'user', 'pass']);
  });

  test('MongoDatabaseAdapter->open connects to db.', async (): Promise<void> => {
    await db?.open();

    expect(db?.getConnection()).toBeInstanceOf(mongoose.Connection);
    expect(db?.getSession()).toBeInstanceOf(mongoose.mongo.ClientSession);
  });

  test('MongoDatabaseAdapter->close disconnects from db.', async (): Promise<void> => {
    await db?.open();

    await db?.close();

    expect(db?.getConnection()).toBeNull();
    expect(db?.getSession()).toBeNull();
  });

  test('MongoDatabaseAdapter->init initializes test table.', async (): Promise<void> => {
    await db?.open();

    await db?.init({ table: 'test_', fields: {}, key: '' });

    expect('test_' in (db?.getCollections() ?? {})).toBe(true);
    expect(db?.getCollections()?.test_?.collectionName).toBe('test_');
  });

  test('MongoDatabaseAdapter->add adds item.', async (): Promise<void> => {
    await db?.open();
    await db?.init({ table: 'test_', fields: {}, key: '' });

    await db?.add('test_', { prop1: 1, prop2: 2 });

    const item = await getItem(db, { prop1: 1 });
    expect(item).toEqual({ prop1: 1, prop2: 2 });
  });

  test('MongoDatabaseAdapter->update updates item, without key change.', async (): Promise<void> => {
    await db?.open();
    await db?.init({ table: 'test_', fields: {}, key: '' });
    await db?.add('test_', { testProp1: 'A', testProp2: 2 });

    await db?.update('test_', 'testProp1', 'A', { testProp2: 22, testProp3: 3 });

    const item = await getItem(db, { testProp1: 'A' });
    expect(item).toEqual({ testProp1: 'A', testProp2: 22, testProp3: 3 });
  });

  test('MongoDatabaseAdapter->update updates item, with key change.', async (): Promise<void> => {
    await db?.open();
    await db?.init({ table: 'test_', fields: {}, key: '' });
    await db?.add('test_', { testProp1: 'A', testProp2: 2 });

    await db?.update('test_', 'testProp1', 'A', { testProp1: 'B', testProp3: 3 });

    const item1 = await getItem(db, { testProp1: 'A' });
    const item2 = await getItem(db, { testProp1: 'B' });
    expect(item2).toEqual({ testProp1: 'B', testProp2: 2, testProp3: 3 });
    expect(item1).toBeNull();
  });

  test('MongoDatabaseAdapter->findOne finds one.', async (): Promise<void> => {
    await db?.open();
    await db?.init({ table: 'test_', fields: {}, key: '' });
    await db?.add('test_', { testProp1: 'A', testProp2: 2 });

    const item = await db?.findOne('test_', 'testProp1', 'A');

    expect(item).toEqual({ testProp1: 'A', testProp2: 2 });
  });

  test('MongoDatabaseAdapter->findAll finds all, no limit', async (): Promise<void> => {
    const testItems = [
      { testProp1: 'A1', testProp2: 21 },
      { testProp1: 'A2', testProp2: 22 },
      { testProp1: 'A3', testProp2: 23 }
    ];
    await db?.open();
    await db?.init({ table: 'test_', fields: {}, key: '' });
    await db?.add('test_', testItems[0]);
    await db?.add('test_', testItems[1]);
    await db?.add('test_', testItems[2]);

    const items = await db?.findAll('test_');

    expect(items).toEqual(testItems);
  });

  test('MongoDatabaseAdapter->findAll finds all, with limit', async (): Promise<void> => {
    const testItems = [
      { testProp1: 'A1', testProp2: 21 },
      { testProp1: 'A2', testProp2: 22 },
      { testProp1: 'A3', testProp2: 23 },
      { testProp1: 'A4', testProp2: 24 }
    ];
    await db?.open();
    await db?.init({ table: 'test_', fields: {}, key: 'key' });
    await db?.add('test_', testItems[0]);
    await db?.add('test_', testItems[1]);
    await db?.add('test_', testItems[2]);
    await db?.add('test_', testItems[3]);

    const items = await db?.findAll('test_', { skip: 1, get: 2 });

    expect(items).toEqual([testItems[1], testItems[2]]);
  });

  test('MongoDatabaseAdapter->findMany finds many, no limit', async (): Promise<void> => {
    const testItems = [
      { testProp1: 'A1', testProp2: 'A' },
      { testProp1: 'A2', testProp2: 'A' },
      { testProp1: 'A3', testProp2: 'B' }
    ];
    await db?.open();
    await db?.init({ table: 'test_', fields: {}, key: '...' });
    await db?.add('test_', testItems[0]);
    await db?.add('test_', testItems[1]);
    await db?.add('test_', testItems[2]);

    const items = await db?.findMany('test_', 'testProp2', 'A');

    expect(items).toEqual([testItems[0], testItems[1]]);
  });

  test('MongoDatabaseAdapter->findMany finds many, with limit', async (): Promise<void> => {
    const testItems = [
      { testProp1: 'A1', testProp2: 'A' },
      { testProp1: 'A2', testProp2: 'B' },
      { testProp1: 'A3', testProp2: 'B' },
      { testProp1: 'A4', testProp2: 'B' }
    ];
    await db?.open();
    await db?.init({ table: 'test_', fields: {}, key: '.' });
    await db?.add('test_', testItems[0]);
    await db?.add('test_', testItems[1]);
    await db?.add('test_', testItems[2]);
    await db?.add('test_', testItems[3]);

    const items = await db?.findMany('test_', 'testProp2', 'B', { skip: 1, get: 2 });

    expect(items).toEqual([testItems[2], testItems[3]]);
  });

  test('MongoDatabaseAdapter->exists checks for existence correctly.', async (): Promise<void> => {
    await db?.open();
    await db?.init({ table: 'test_', fields: {}, key: '' });
    await db?.add('test_', { testProp1: 'A', testProp2: 2 });

    const existsA = await db?.exists('test_', 'testProp1', 'A');
    const existsB = await db?.exists('test_', 'testProp1', 'B');

    expect(existsA).toBe(true);
    expect(existsB).toBe(false);
  });

  test('MongoDatabaseAdapter->delete deletes correctly.', async (): Promise<void> => {
    await db?.open();
    await db?.init({ table: 'test_', fields: {}, key: '' });
    await db?.add('test_', { testProp1: 'A', testProp2: 2 });
    await db?.add('test_', { testProp1: 'B', testProp2: 2 });

    await db?.delete('test_', 'testProp1', 'A');

    expect(await getItem(db, { testProp1: 'A' })).toBeNull();
    expect(await getItem(db, { testProp1: 'B' })).not.toBeNull();
  });

  describe('errors', () => {
    test('MongoDatabaseAdapter->delete throws exception correctly.', async (): Promise<void> => {
      await db?.open();
      await db?.init({ table: 'test_', fields: {}, key: '' });
      await db?.add('test_', { testProp1: 'A', testProp2: 2 });
      let error: Error | null = null;

      await db?.delete('test_', 'testProp1', 'B').catch((err) => {
        error = err as Error;
      });

      expect(error).not.toBe(null);
      expect((error as unknown as Error).message).toEqual('Item not found in table test_ where testProp1=B.');
    });

    test('MongoDatabaseAdapter->update throws exception correctly.', async (): Promise<void> => {
      await db?.open();
      await db?.init({ table: 'test_', fields: {}, key: '' });
      await db?.add('test_', { testProp1: 'A', testProp2: 3 });
      let error: Error | null = null;

      await db?.update('test_', 'testProp1', 'B', { testProp2: 5 }).catch((err) => {
        error = err as Error;
      });

      expect(error).not.toBe(null);
      expect((error as unknown as Error).message).toEqual('Item not found in table test_ where testProp1=B.');
    });
  });
});
