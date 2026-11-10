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

    const count = await db.update(tableName, 'testPropStr', 'test', { testPropNo: 23, testPropBool: false });

    const memory = (db as InMemoryDatabaseAdapter).getMemory();
    expect(memory[tableName]?.items?.at(0)?.testPropStr).toEqual('test');
    expect(memory[tableName]?.items?.at(0)?.testPropNo).toBe(23);
    expect(memory[tableName]?.items?.at(0)?.testPropBool).toBe(false);
    expect(count).toBe(1);
  });

  test('InMemoryDatabaseAdapter->update updates items correctly.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await add();
    addItemManually(db, 'testAnother', 23, true);

    const count = await db.update(tableName, 'testPropBool', true, { testPropBool: false });

    const memory = (db as InMemoryDatabaseAdapter).getMemory();
    expect(memory[tableName]?.items?.at(0)?.testPropStr).toEqual('test');
    expect(memory[tableName]?.items?.at(0)?.testPropNo).toBe(42);
    expect(memory[tableName]?.items?.at(0)?.testPropBool).toBe(false);
    expect(memory[tableName]?.items?.at(1)?.testPropStr).toEqual('testAnother');
    expect(memory[tableName]?.items?.at(1)?.testPropNo).toBe(23);
    expect(memory[tableName]?.items?.at(1)?.testPropBool).toBe(false);
    expect(count).toBe(2);
  });

  test('InMemoryDatabaseAdapter->update updates no items.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await add();

    const count = await db.update(tableName, 'testPropStr', 'nope', { testPropBool: false });

    const memory = (db as InMemoryDatabaseAdapter).getMemory();
    expect(memory[tableName]?.items?.at(0)?.testPropStr).toEqual('test');
    expect(memory[tableName]?.items?.at(0)?.testPropNo).toBe(42);
    expect(memory[tableName]?.items?.at(0)?.testPropBool).toBe(true);
    expect(count).toBe(0);
  });

  test('InMemoryDatabaseAdapter->delete deletes item correctly.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await add();
    addAnother(db);

    const count = await db.delete(tableName, 'testPropStr', 'test');

    const memory = (db as InMemoryDatabaseAdapter).getMemory();
    expect(memory[tableName]?.items?.length).toBe(1);
    expect(memory[tableName]?.items?.at(0)?.testPropStr).toEqual('testAnother');
    expect(count).toBe(1);
  });

  test('InMemoryDatabaseAdapter->delete deletes items correctly.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await add();
    addItemManually(db, 'testAnother', 23, true);

    const count = await db.delete(tableName, 'testPropBool', true);

    const memory = (db as InMemoryDatabaseAdapter).getMemory();
    expect(memory[tableName]?.items?.length).toBe(0);
    expect(count).toBe(2);
  });

  test('InMemoryDatabaseAdapter->delete deletes no items.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await add();

    const count = await db.delete(tableName, 'testPropStr', 'nope');

    const memory = (db as InMemoryDatabaseAdapter).getMemory();
    expect(memory[tableName]?.items?.length).toBe(1);
    expect(count).toBe(0);
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

  test('InMemoryDatabaseAdapter->findAllSince finds all items since, correctly.', async (): Promise<void> => {
    const tableName = 'testTable';
    const db = await init();
    const memory = (db as InMemoryDatabaseAdapter).getMemory();
    memory.testTable?.items.push({ testPropStr: 'test1', testPropNo: 42, testPropBool: false, lastModified: new Date(5) });
    memory.testTable?.items.push({ testPropStr: 'test2', testPropNo: 42, testPropBool: false, lastModified: new Date(9) });
    memory.testTable?.items.push({ testPropStr: 'test3', testPropNo: 42, testPropBool: false, lastModified: new Date(9) });
    memory.testTable?.items.push({ testPropStr: 'test4', testPropNo: 42, testPropBool: false });

    const items = await db.findAllSince(tableName, new Date(7));

    expect(items?.length).toBe(2);
    expect(items?.at(0)?.testPropStr).toEqual('test2');
    expect(items?.at(1)?.testPropStr).toEqual('test3');
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
});
