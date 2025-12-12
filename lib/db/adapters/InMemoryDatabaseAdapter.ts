import { DatabaseAdapter, DbItem, DbValue, DbLimit } from '@/db/types/DatabaseAdapter';

interface Table {
  name: string;
  fields: string[];
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
}

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

  public async init(table: string, fields: string[], key: string): Promise<void> {
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

  public async update(table: string, filterKey: string, filterValue: DbValue, update: Record<string, DbValue>): Promise<void> {
    const item = this.memory[table].items.find((item) => item[filterKey] === filterValue);
    if (!item) {
      throw new Error(`Item not found in table ${table} where ${filterKey}=${filterValue}.`);
    }
    Object.keys(update).forEach((key) => {
      item[key] = update[key];
    });
  }

  public async exists(table: string, filterKey: string, filterValue: DbValue): Promise<boolean> {
    const item = this.memory[table].items.find((item) => item[filterKey] === filterValue);
    return !!item;
  }

  public async delete(table: string, filterKey: string, filterValue: DbValue): Promise<void> {
    const index = this.memory[table].items.findIndex((item) => item[filterKey] === filterValue);
    if (index < 0) {
      throw new Error(`Item not found in table ${table} where ${filterKey}=${filterValue}.`);
    }
    this.memory[table].items.splice(index, 1);
  }

  public async findOne(table: string, filterKey: string, filterValue: DbValue): Promise<DbItem | null> {
    const item = this.memory[table].items.find((item) => item[filterKey] === filterValue);
    return item ? item : null;
  }

  public async findMany(table: string, filterKey: string, filterValue: DbValue, dbLimit?: DbLimit): Promise<DbItem[]> {
    const items = this.memory[table].items.filter((item) => item[filterKey] === filterValue);
    return applyLimit(items, dbLimit);
  }

  public async findAll(table: string, dbLimit?: DbLimit): Promise<DbItem[]> {
    const items = this.memory[table].items;
    return applyLimit(items, dbLimit);
  }
}

export { InMemoryDatabaseAdapter };
