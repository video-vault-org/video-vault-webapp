import { DatabaseAdapter } from '@/db/types/DatabaseAdapter';
import { DbTableDefinition } from '@/db/types/DbTableDefinition';
import { DbValue } from '@/db/types/DbValue';
import { DbPrimitiveValue } from '@/db/types/DbPrimitiveValue';
import { DbItem } from '@/db/types/DbItem';
import { DbLimit } from '@/db/types/DbLimit';

interface Table {
  name: string;
  fields: Record<string, DbValue>;
  key: string;
  items: DbItem[];
}

type Memory = Record<string, Table>;

const applyLimit = function (items: DbItem[], limit?: DbLimit): DbItem[] {
  if (!limit) {
    return items;
  }
  const skip = limit.skip ?? 0;
  const get = limit.get ?? items.length;
  return items.slice(skip, skip + get);
};

/**
 * In-Memory Database Adapter, mostly for testing, not suitable for production, no data will be persistent
 */
class InMemoryDatabaseAdapter implements DatabaseAdapter {
  private dbOpen = false;
  private readonly memory: Memory;

  public constructor() {
    this.memory = {};
  }

  public isOpen() {
    return this.dbOpen;
  }

  public getMemory() {
    return this.memory;
  }

  public async open(): Promise<void> {
    this.dbOpen = true;
  }

  public async close(): Promise<void> {
    this.dbOpen = false;
  }

  public async init({ table, fields, key }: DbTableDefinition): Promise<void> {
    this.memory[table] = {
      name: table,
      fields,
      key,
      items: []
    };
  }

  public async add(table: string, item: DbItem): Promise<void> {
    this.memory[table].items.push(item);
  }

  public async update(table: string, filterKey: string, filterValue: DbPrimitiveValue, update: Record<string, DbValue>): Promise<void> {
    const item = this.memory[table].items.find((item) => item[filterKey] === filterValue);
    if (!item) {
      throw new Error(`Item not found in table ${table} where ${filterKey}=${filterValue}.`);
    }
    Object.keys(update).forEach((key) => {
      item[key] = update[key];
    });
  }

  public async exists(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<boolean> {
    const item = this.memory[table].items.find((item) => item[filterKey] === filterValue);
    return !!item;
  }

  public async delete(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<void> {
    const index = this.memory[table].items.findIndex((item) => item[filterKey] === filterValue);
    if (index < 0) {
      throw new Error(`Item not found in table ${table} where ${filterKey}=${filterValue}.`);
    }
    this.memory[table].items.splice(index, 1);
  }

  public async findOne(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<DbItem | null> {
    const item = this.memory[table].items.find((item) => item[filterKey] === filterValue);
    return item ? item : null;
  }

  public async findMany(table: string, filterKey: string, filterValue: DbPrimitiveValue, dbLimit?: DbLimit): Promise<DbItem[]> {
    const items = this.memory[table].items.filter((item) => item[filterKey] === filterValue);
    return applyLimit(items, dbLimit);
  }

  public async findAll(table: string, dbLimit?: DbLimit): Promise<DbItem[]> {
    const items = this.memory[table].items;
    return applyLimit(items, dbLimit);
  }
}

export { InMemoryDatabaseAdapter };
