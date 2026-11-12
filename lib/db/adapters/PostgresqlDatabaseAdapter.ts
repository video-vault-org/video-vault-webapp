import { Client } from 'pg';
import { DatabaseAdapter } from '@/db/types/DatabaseAdapter';
import { DbTableDefinition } from '@/db/types/DbTableDefinition';
import { DbValue } from '@/db/types/DbValue';
import { DbPrimitiveValue } from '@/db/types/DbPrimitiveValue';
import { DbItem } from '@/db/types/DbItem';
import { PaginationParams } from '@/db/types/PaginationParams';
import { PostgresqlDatabaseConf } from '@/db/types/PostgresqlDatabaseConf';

/**
 * Postgresql Database Adapter
 */
class PostgresqlDatabaseAdapter implements DatabaseAdapter {
  private readonly client: Client;
  private readonly tablesWithCreated = new Set<string>();
  private connected = false;

  /**
   * Constructor
   * @param host the ip or domain, postgresql shall connect to
   * @param port the port, postgresql shall connect to
   * @param database the name of the database, postgresql shall connect to
   * @param user (optional) username for authorization
   * @param password (optional) password for authorization
   */
  public constructor({ host, port, database, user, password }: PostgresqlDatabaseConf) {
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
    const query = `SELECT * FROM ${table} WHERE "${filterKey}"=$1 LIMIT 1`;
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
    if (fields.created === 'Date') {
      this.tablesWithCreated.add(table);
    }
  }

  public async add(table: string, item: DbItem): Promise<void> {
    const valueParts: string[] = [];
    const keys: string[] = [];
    const values: (DbPrimitiveValue | Date)[] = [];
    let index = 1;
    Object.entries(item).forEach(([key, value]) => {
      valueParts.push(`$${index++}`);
      keys.push(`"${key}"`);
      values.push(typeof value === 'object' && !(value instanceof Date) ? JSON.stringify(value) : value);
    });
    const query = `INSERT INTO ${table}(${keys.join(', ')}) VALUES(${valueParts.join(', ')})`;
    await this.client?.query(query, values);
  }

  public async update(table: string, filterKey: string, filterValue: DbPrimitiveValue, update: Record<string, DbValue>): Promise<number> {
    let index = 1;
    const updateParts: string[] = [];
    const updateValues: (DbPrimitiveValue | Date)[] = [];
    Object.entries(update).forEach(([key, value]) => {
      updateParts.push(`"${key}"=$${index++}`);
      updateValues.push(typeof value === 'object' && !(value instanceof Date) ? JSON.stringify(value) : value);
    });
    const updater = `SET ${updateParts.join(', ')}`;
    const values = [...updateValues, filterValue];
    const query = `UPDATE ${table} ${updater} WHERE "${filterKey}"=$${values.length}`;
    const result = await this.client?.query(query, values);
    return result.rowCount ?? 0;
  }

  public async exists(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<boolean> {
    const item = await this.findOneIfExists(table, filterKey, filterValue);
    return !!item;
  }

  public async delete(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<number> {
    const query = `DELETE FROM ${table} WHERE "${filterKey}"=$1`;
    const result = await this.client.query(query, [filterValue]);
    return result.rowCount ?? 0;
  }

  public async findOne(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<DbItem | null> {
    const item = await this.findOneIfExists(table, filterKey, filterValue);
    return item ? item : null;
  }

  public async findMany(table: string, filterKey: string, filterValue: DbPrimitiveValue, pagination: PaginationParams): Promise<DbItem[]> {
    const values = [filterValue];
    let query = `SELECT * FROM ${table} WHERE ${this.client.escapeIdentifier(filterKey)}=$1`;
    if (this.tablesWithCreated.has(table)) {
      query += ' ORDER BY "created" DESC NULLS LAST';
    }
    if (pagination.get !== undefined) {
      query += ` LIMIT $${values.push(pagination.get)}`;
    }
    if (pagination.skip !== undefined) {
      query += ` OFFSET $${values.push(pagination.skip)}`;
    }
    return (await this.client.query<DbItem>(query, values)).rows;
  }

  public async findAll(table: string): Promise<DbItem[]> {
    return (await this.client.query<DbItem>(`SELECT * FROM ${table}`)).rows;
  }

  public async findAllSince(table: string, since: Date): Promise<DbItem[]> {
    const columnCheckQuery = `SELECT * FROM information_schema.columns WHERE table_name = '${table}' AND column_name = 'lastModified'`;
    const checkResult = await this.client?.query(columnCheckQuery);
    if (checkResult.rowCount === 0) {
      return [];
    }
    const query = `SELECT * FROM ${table} WHERE "lastModified" >= $1`;
    const result = await this.client?.query<DbItem>(query, [since]);
    if (!result || result.rowCount === 0) {
      return [];
    }
    return result.rows;
  }
}

export { PostgresqlDatabaseAdapter };
