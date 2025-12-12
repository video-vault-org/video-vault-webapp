import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { DatabaseAdapter } from '@/db/types/DatabaseAdapter';
import { DbFieldDefinition } from '@/db/types/DbFieldDefinition';

describe('InMemoryDatabaseAdapter', (): void => {
  const init = async function (): Promise<DatabaseAdapter> {
    const table = 'testTable';
    const fields: DbFieldDefinition = { testPropStr: 'string', testPropNo: 'string', testPropBool: 'boolean' };
    const key = 'testPropStr';
    const db = new InMemoryDatabaseAdapter();
    await db.open();
    await db.init({ table, fields, key });
    return db;
  };

  const addItemManually = function (db: DatabaseAdapter, testPropStr: string, testPropNo: number, testPropBool: boolean): void {
    const memory = (db as InMemoryDatabaseAdapter).getMemory();
    memory.testTable?.items.push({ testPropStr, testPropNo, testPropBool });
  };

  const add = async function (count?: number): Promise<DatabaseAdapter> {
    const db = await init();
    const suffix = count ? count : '';
    const addition = count ?? 0;
    addItemManually(db, `test${suffix}`, 42 + addition, true);
    return db;
  };

  const addAnother = function (db: DatabaseAdapter): void {
    addItemManually(db, 'testAnother', 23, false);
  };

  const addMuch = function (db: DatabaseAdapter): void {
    for (let i = 0; i < 30; i++) {
      addItemManually(db, 'test' + i, 100 + i, !!(i % 2));
    }
    addItemManually(db, 'testLast', 1, true);
    addItemManually(db, 'testLast', 2, true);
    addItemManually(db, 'testLast', 3, true);
  };

  test('InMemoryDatabaseAdapter->open opens db.', async (): Promise<void> => {
    const db = new InMemoryDatabaseAdapter();

    await db.open();

    expect(db.isOpen()).toBe(true);
  });

  test('InMemoryDatabaseAdapter->close closes db.', async (): Promise<void> => {
    const db = new InMemoryDatabaseAdapter();
    await db.open();

    await db.close();

    expect(db.isOpen()).toBe(false);
  });

  test('InMemoryDatabaseAdapter->init inits table correctly.', async (): Promise<void> => {
    const table = 'testTable';
    const fields: DbFieldDefinition = { fieldA: 'string', fieldB: 'string' };
    const key = 'fieldB';
    const db = new InMemoryDatabaseAdapter();
    await db.open();

    await db.init({ table, fields, key });

    const memory = db.getMemory();
    expect(memory[table]?.name).toEqual(table);
    expect(memory[table]?.fields).toEqual(fields);
    expect(memory[table]?.key).toEqual(key);
    expect(memory[table]?.items).toEqual([]);
  });

  test('InMemoryDatabaseAdapter->add adds item correctly.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await init();

    await db.add(tableName, { testPropStr: 'test', testPropNo: 42, testPropBool: true });

    const memory = (db as InMemoryDatabaseAdapter).getMemory();
    expect(memory[tableName]?.items?.at(0)?.testPropStr).toEqual('test');
    expect(memory[tableName]?.items?.at(0)?.testPropNo).toBe(42);
    expect(memory[tableName]?.items?.at(0)?.testPropBool).toBe(true);
  });

  test('InMemoryDatabaseAdapter->update updates item correctly.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await add();

    await db.update(tableName, 'testPropStr', 'test', { testPropNo: 23, testPropBool: false });

    const memory = (db as InMemoryDatabaseAdapter).getMemory();
    expect(memory[tableName]?.items?.at(0)?.testPropStr).toEqual('test');
    expect(memory[tableName]?.items?.at(0)?.testPropNo).toBe(23);
    expect(memory[tableName]?.items?.at(0)?.testPropBool).toBe(false);
  });

  test('InMemoryDatabaseAdapter->delete deletes item correctly.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await add();
    addAnother(db);

    await db.delete(tableName, 'testPropStr', 'test');

    const memory = (db as InMemoryDatabaseAdapter).getMemory();
    expect(memory[tableName]?.items?.length).toBe(1);
    expect(memory[tableName]?.items?.at(0)?.testPropStr).toEqual('testAnother');
  });

  test('InMemoryDatabaseAdapter->exists checks for existence correctly.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await add();

    const exists1 = await db.exists(tableName, 'testPropStr', 'test');
    const exists2 = await db.exists(tableName, 'testPropStr', 'testAnother');

    expect(exists1).toBe(true);
    expect(exists2).toBe(false);
  });

  test('InMemoryDatabaseAdapter->findOne finds one item correctly.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await add();

    const item = await db.findOne(tableName, 'testPropStr', 'test');

    expect(item?.testPropStr).toEqual('test');
    expect(item?.testPropNo).toBe(42);
    expect(item?.testPropBool).toBe(true);
  });

  test('InMemoryDatabaseAdapter->findOne finds nothing.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await add();

    const item = await db.findOne(tableName, 'testPropStr', 'testAnother');

    expect(item).toBe(null);
  });

  test('InMemoryDatabaseAdapter->findAll finds all items correctly.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await add();
    addAnother(db);

    const items = await db.findAll(tableName);

    expect(items?.length).toBe(2);
    expect(items?.at(0)?.testPropStr).toEqual('test');
    expect(items?.at(0)?.testPropNo).toBe(42);
    expect(items?.at(0)?.testPropBool).toBe(true);
    expect(items?.at(1)?.testPropStr).toEqual('testAnother');
    expect(items?.at(1)?.testPropNo).toBe(23);
    expect(items?.at(1)?.testPropBool).toBe(false);
  });

  test('InMemoryDatabaseAdapter->findAll finds nothing correctly.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await init();

    const items = await db.findAll(tableName);

    expect(items?.length).toBe(0);
  });

  test('InMemoryDatabaseAdapter->findAll finds paged items correctly.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await init();
    addMuch(db);

    const items = await db.findAll(tableName, { skip: 10, get: 15 });

    expect(items?.length).toBe(15);
    expect(items?.at(0)?.testPropStr).toEqual('test10');
    expect(items?.at(14)?.testPropStr).toEqual('test24');
  });

  test('InMemoryDatabaseAdapter->findMany finds many items correctly.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await init();
    addMuch(db);

    const items = await db.findMany(tableName, 'testPropStr', 'testLast');

    expect(items?.length).toBe(3);
    expect(items?.at(0)?.testPropNo).toEqual(1);
    expect(items?.at(1)?.testPropNo).toEqual(2);
    expect(items?.at(2)?.testPropNo).toEqual(3);
  });

  test('InMemoryDatabaseAdapter->findMany finds nothing correctly.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await init();
    addMuch(db);

    const items = await db.findMany(tableName, 'testPropStr', 'testNoting');

    expect(items?.length).toBe(0);
  });

  test('InMemoryDatabaseAdapter->findMany finds many paged items correctly.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await init();
    addMuch(db);

    const items = await db.findMany(tableName, 'testPropStr', 'testLast', { skip: 1, get: 2 });

    expect(items?.length).toBe(2);
    expect(items?.at(0)?.testPropNo).toEqual(2);
    expect(items?.at(1)?.testPropNo).toEqual(3);
  });

  describe('errors', () => {
    test('InMemoryDatabaseAdapter->delete throws exception correctly.', async (): Promise<void> => {
      const tableName = 'testTable';
      const db = await add();
      let error: Error | null = null;

      await db.delete(tableName, 'testPropStr', 'testAnother').catch((err) => {
        error = err as Error;
      });

      expect(error).not.toBe(null);
      expect((error as unknown as Error).message).toEqual('Item not found in table testTable where testPropStr=testAnother.');
    });

    test('InMemoryDatabaseAdapter->update throws exception correctly.', async (): Promise<void> => {
      const tableName = 'testTable';
      const db = await add();
      let error: Error | null = null;

      await db.update(tableName, 'testPropStr', 'testAnother', {}).catch((err) => {
        error = err as Error;
      });

      expect(error).not.toBe(null);
      expect((error as unknown as Error).message).toEqual('Item not found in table testTable where testPropStr=testAnother.');
    });
  });
});
