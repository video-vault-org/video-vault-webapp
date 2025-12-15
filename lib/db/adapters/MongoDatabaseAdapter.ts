import mongoose from 'mongoose';
import { DatabaseAdapter } from '../types/DatabaseAdapter';
import { MongoItem } from '../types/MongoItem';
import { DbTableDefinition } from '@/db/types/DbTableDefinition';
import { DbLimit } from '@/db/types/DbLimit';
import { DbItem } from '@/db/types/DbItem';
import { DbValue } from '@/db/types/DbValue';
import { DbPrimitiveValue } from '@/db/types/DbPrimitiveValue';
import { MongoDatabaseConf } from '@/db/types/MongoDatabaseConf';

const applyFilter = function (itemsCursor: mongoose.mongo.FindCursor, limit?: DbLimit): mongoose.mongo.FindCursor {
  if (limit?.skip) {
    itemsCursor = itemsCursor?.skip(limit.skip);
  }
  if (limit?.get) {
    itemsCursor = itemsCursor?.limit(limit.get);
  }
  return itemsCursor;
};

/**
 * Database Adapter for MongoDB.
 */
class MongoDatabaseAdapter implements DatabaseAdapter {
  private readonly url: string;
  private readonly user?: string;
  private readonly pass?: string;
  private connection: null | mongoose.Connection = null;
  private session: null | mongoose.mongo.ClientSession = null;
  private collections: Record<string, mongoose.Collection<DbItem>> = {};

  /**
   * Constructor
   * @param url the url, MongoDB shall connect to (http://`host`:`port`/`databaseName`)
   * @param user (optional) username for authorization
   * @param pass (optional) password for authorization
   */
  public constructor({ url, user, pass }: MongoDatabaseConf) {
    this.url = url;
    this.user = user;
    this.pass = pass;
  }

  public getConf(): [string, string, string] {
    return [this.url, this.user ?? '', this.pass ?? ''];
  }

  public getConnection(): mongoose.Connection | null {
    return this.connection;
  }

  public getSession(): mongoose.mongo.ClientSession | null {
    return this.session;
  }

  public getCollections(): Record<string, mongoose.Collection<DbItem>> {
    return this.collections;
  }

  public async open(): Promise<void> {
    if (!this.session) {
      this.connection = mongoose.createConnection(this.url, { directConnection: true, user: this.user, pass: this.pass });
      this.session = await this.connection.startSession();
    }
  }

  public async close(): Promise<void> {
    if (!!this.session) {
      await this.session?.endSession();
      await this.connection?.close();
      this.session = null;
      this.connection = null;
    }
  }

  public async init({ table }: DbTableDefinition): Promise<void> {
    if (!this.connection) {
      throw new Error('Error. Not connected');
    }
    if (!!this.collections[table]) {
      return;
    }
    this.collections[table] = this.connection.collection<DbItem>(table);
  }

  public async add(table: string, item: DbItem): Promise<void> {
    const collection = this.collections[table];
    await collection?.insertOne({ ...item });
  }

  public async update(table: string, filterKey: string, filterValue: DbPrimitiveValue, update: Record<string, DbValue>): Promise<void> {
    const collection = this.collections[table];
    const item = await this.findOne(table, filterKey, filterValue);
    if (!item) {
      throw new Error(`Item not found in table ${table} where ${filterKey}=${filterValue}.`);
    }
    await collection?.findOneAndUpdate({ [filterKey]: filterValue }, { $set: update });
  }

  public async exists(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<boolean> {
    const collection = this.collections[table];
    const item = await collection?.findOne({ [filterKey]: filterValue });
    return !!item;
  }

  public async delete(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<void> {
    const collection = this.collections[table];
    const item = await collection?.findOneAndDelete({ [filterKey]: filterValue });
    if (!item) {
      throw new Error(`Item not found in table ${table} where ${filterKey}=${filterValue}.`);
    }
  }

  public async findOne(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<DbItem | null> {
    const collection = this.collections[table];
    const item: MongoItem | null = await collection?.findOne({ [filterKey]: filterValue });
    if (!item) {
      return null;
    }
    delete item._id;
    return item as DbItem;
  }

  public async findMany(table: string, filterKey: string, filterValue: DbPrimitiveValue, dbLimit?: DbLimit): Promise<DbItem[]> {
    const collection = this.collections[table];
    const items: DbItem[] = [];
    const itemsCursor = applyFilter(collection?.find({ [filterKey]: filterValue }), dbLimit);
    while (await itemsCursor?.hasNext()) {
      const doc = await itemsCursor?.next();
      if (!doc) {
        continue;
      }
      const item: DbItem = {
        ...doc
      };
      delete item._id;
      items.push(item);
    }
    return items;
  }

  public async findAll(table: string, dbLimit?: DbLimit): Promise<DbItem[]> {
    const collection = this.collections[table];
    const items: DbItem[] = [];
    const itemsCursor = applyFilter(collection?.find(), dbLimit);
    while (await itemsCursor?.hasNext()) {
      const doc = await itemsCursor?.next();
      if (!doc) {
        continue;
      }
      const item: DbItem = {
        ...doc
      };
      delete item._id;
      items.push(item);
    }
    return items;
  }
}

export { MongoDatabaseAdapter, MongoItem };
