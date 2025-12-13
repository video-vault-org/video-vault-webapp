import { Client } from 'pg';
import { DatabaseAdapter } from '@/db/types/DatabaseAdapter';
import { DbTableDefinition } from '@/db/types/DbTableDefinition';
import { DbValue } from '@/db/types/DbValue';
import { DbPrimitiveValue } from '@/db/types/DbPrimitiveValue';
import { DbItem } from '@/db/types/DbItem';
import { DbLimit } from '@/db/types/DbLimit';

const buildLimit = function (dbLimit?: DbLimit) {
  const offset = dbLimit?.skip ? `OFFSET ${dbLimit?.skip}` : '';
  const limit = dbLimit?.get ? `LIMIT ${dbLimit?.get}` : '';
  return ` ${limit} ${offset}`;
};

/**
 * Postgresql Database Adapter
 */
class PostgresqlDatabaseAdapter implements DatabaseAdapter {
  private readonly client: Client;
  private connected = false;

  /**
   * Constructor
   * @param host the ip or domain, postgresql shall connect to
   * @param port the port, postgresql shall connect to
   * @param database the name of the database, postgresql shall connect to
   * @param user (optional) username for authorization
   * @param password (optional) password for authorization
   */
  public constructor(host: string, port: number, database: string, user?: string, password?: string) {
    this.client = new Client({ host, port, database, user, password });
  }

  public getConf(): [string, number, string, string | undefined, string | undefined] {
    return [this.client?.host ?? '-', this.client?.port ?? -1, this.client?.database ?? '-', this.client?.user, this.client?.password];
  }

  public getClient(): Client {
    return this.client;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  private async findOneIfExists(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<DbItem | undefined> {
    const query = `SELECT * FROM ${table} WHERE "${filterKey}"=$1`;
    const values = [filterValue];
    const result = await this.client?.query<DbItem>(query, values);
    if (!result || result.rowCount !== 1) {
      return undefined;
    }
    return result.rows[0];
  }

  public async open(): Promise<void> {
    if (this.connected) {
      return;
    }
    await this.client?.connect();
    this.connected = true;
  }

  public async close(): Promise<void> {
    if (this.connected) {
      await this.client?.end();
      this.connected = false;
    }
  }

  public async init({ table, fields }: DbTableDefinition): Promise<void> {
    const types: Record<string, string> = {
      string: 'text',
      number: 'integer',
      boolean: 'Boolean',
      object: 'JSON',
      Date: 'timestamptz'
    };
    const fieldsArray: string[] = [];
    Object.entries(fields).forEach(([name, type]) => {
      fieldsArray.push(`"${name}" ${types[type]}`);
    });
    const query = `CREATE TABLE IF NOT EXISTS ${table}(${fieldsArray.join(', ')})`;
    await this.client?.query(query);
  }

  public async add(table: string, item: DbItem): Promise<void> {
    const valueParts: string[] = [];
    const keys: string[] = [];
    const values: DbPrimitiveValue[] = [];
    let index = 1;
    Object.entries(item).forEach(([key, value]) => {
      valueParts.push(`$${index++}`);
      keys.push(`"${key}"`);
      values.push(typeof value === 'object' ? JSON.stringify(value) : value);
    });
    const query = `INSERT INTO ${table}(${keys.join(', ')}) VALUES(${valueParts.join(', ')})`;
    await this.client?.query(query, values);
  }

  public async update(table: string, filterKey: string, filterValue: DbPrimitiveValue, update: Record<string, DbValue>): Promise<void> {
    const item = await this.findOneIfExists(table, filterKey, filterValue);
    if (!item) {
      throw new Error(`Item not found in table ${table} where ${filterKey}=${filterValue}.`);
    }
    let index = 1;
    const updateParts: string[] = [];
    const updateValues: DbPrimitiveValue[] = [];
    Object.entries(update).forEach(([key, value]) => {
      updateParts.push(`"${key}"=$${index++}`);
      updateValues.push(typeof value === 'object' ? JSON.stringify(value) : value);
    });
    const updater = `SET ${updateParts.join(', ')}`;
    const values = [...updateValues, filterValue];
    const query = `UPDATE ${table} ${updater} WHERE "${filterKey}"=$${values.length}`;
    await this.client?.query(query, values);
  }

  public async exists(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<boolean> {
    const item = await this.findOneIfExists(table, filterKey, filterValue);
    return !!item;
  }

  public async delete(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<void> {
    const item = await this.findOneIfExists(table, filterKey, filterValue);
    if (!item) {
      throw new Error(`Item not found in table ${table} where ${filterKey}=${filterValue}.`);
    }
    const query = `DELETE FROM ${table} WHERE "${filterKey}"=$1`;
    const values = [filterValue];
    await this.client?.query(query, values);
  }

  public async findOne(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<DbItem | null> {
    const item = await this.findOneIfExists(table, filterKey, filterValue);
    return item ? item : null;
  }

  public async findMany(table: string, filterKey: string, filterValue: DbPrimitiveValue, dbLimit?: DbLimit): Promise<DbItem[]> {
    const limit = buildLimit(dbLimit);
    const query = `SELECT * FROM ${table} WHERE "${filterKey}"=$1 ${limit}`;
    const values = [filterValue];
    const result = await this.client?.query<DbItem>(query, values);
    if (!result || result.rowCount === 0) {
      return [];
    }
    return result.rows;
  }

  public async findAll(table: string, dbLimit?: DbLimit): Promise<DbItem[]> {
    const limit = buildLimit(dbLimit);
    const query = `SELECT * FROM ${table} ${limit}`;
    const result = await this.client?.query<DbItem>(query);
    if (!result || result.rowCount === 0) {
      return [];
    }
    return result.rows;
  }
}

export { PostgresqlDatabaseAdapter };
