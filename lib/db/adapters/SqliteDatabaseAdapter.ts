import type { DatabaseSync } from 'node:sqlite';
import { DatabaseAdapter } from '@/db/types/DatabaseAdapter';
import { DbFieldDefinition } from '@/db/types/DbFieldDefinition';
import { DbItem } from '@/db/types/DbItem';
import { DbPrimitiveValue } from '@/db/types/DbPrimitiveValue';
import { DbTableDefinition } from '@/db/types/DbTableDefinition';
import { DbValue } from '@/db/types/DbValue';
import { PaginationParams } from '@/db/types/PaginationParams';
import { SqliteDatabaseConf } from '@/db/types/SqliteDatabaseConf';

type ColumnType = DbFieldDefinition[string];

const columnTypes: Record<ColumnType, string> = {
  string: 'TEXT',
  number: 'REAL',
  boolean: 'INTEGER',
  Date: 'INTEGER',
  object: 'TEXT'
};

function identifier(name: string): string {
  if (!name || name.includes('\0')) {
    throw new TypeError('Invalid SQLite identifier');
  }
  return `"${name.replace(/"/g, '""')}"`;
}

function encode(value: DbValue): string | number {
  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isFinite(time)) {
      throw new RangeError('Invalid SQLite date');
    }
    return time;
  }
  if (typeof value === 'boolean') {
    return Number(value);
  }
  return typeof value === 'object' ? JSON.stringify(value) : value;
}

/** File-backed SQLite adapter. Use ":memory:" for a temporary database. */
class SqliteDatabaseAdapter implements DatabaseAdapter {
  private database?: DatabaseSync;
  private readonly definitions = new Map<string, DbTableDefinition>();
  private readonly filePath: string;

  public constructor({ filePath }: SqliteDatabaseConf) {
    this.filePath = filePath;
  }

  public async open(): Promise<void> {
    if (!this.database) {
      const { DatabaseSync } = await import('node:sqlite');
      this.database ??= new DatabaseSync(this.filePath);
    }
  }

  public async close(): Promise<void> {
    this.database?.close();
    this.database = undefined;
    this.definitions.clear();
  }

  public async init(definition: DbTableDefinition): Promise<void> {
    const { table, fields, key } = definition;
    const database = this.connection();
    const tableName = identifier(table);
    const columns = Object.entries(fields).map(([field, type]) => {
      const constraints = field === key ? ' NOT NULL PRIMARY KEY' : '';
      return `${identifier(field)} ${columnTypes[type]}${constraints}`;
    });
    if (key && !Object.prototype.hasOwnProperty.call(fields, key)) {
      throw new Error(`Unknown SQLite primary key: ${table}.${key}`);
    }
    database.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (${columns.join(', ')}) STRICT`);

    if (table === 'comment' && fields.videoId === 'string' && fields.created === 'Date') {
      const order = key && key !== 'created' && key !== 'videoId' ? `, ${identifier(key)}` : '';
      database.exec(`CREATE INDEX IF NOT EXISTS "comment_by_video_created" ON ${tableName} ("videoId", "created" DESC${order})`);
    }
    if (fields.lastModified === 'Date') {
      database.exec(`CREATE INDEX IF NOT EXISTS ${identifier(`idx_${table}_last_modified`)} ON ${tableName} ("lastModified")`);
    }
    this.definitions.set(table, definition);
  }

  public async add(table: string, item: DbItem): Promise<void> {
    const definition = this.definition(table);
    const entries = Object.entries(item);
    const columns = entries.map(([field]) => this.column(definition, field));
    const values = entries.map(([, value]) => encode(value));
    const tableName = identifier(table);
    const sql = columns.length ? `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${values.map(() => '?').join(', ')})` : `INSERT INTO ${tableName} DEFAULT VALUES`;
    this.connection()
      .prepare(sql)
      .run(...values);
  }

  public async update(table: string, filterKey: string, filterValue: DbPrimitiveValue, update: Record<string, DbValue>): Promise<number> {
    const definition = this.definition(table);
    const filter = this.column(definition, filterKey);
    const entries = Object.entries(update);
    if (!entries.length) {
      return 0;
    }
    const assignments = entries.map(([field]) => `${this.column(definition, field)} = ?`);
    const values = entries.map(([, value]) => encode(value));
    const sql = `UPDATE ${identifier(table)} SET ${assignments.join(', ')} WHERE ${filter} = ?`;
    return Number(
      this.connection()
        .prepare(sql)
        .run(...values, encode(filterValue)).changes
    );
  }

  public async exists(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<boolean> {
    const filter = this.column(this.definition(table), filterKey);
    const sql = `SELECT 1 FROM ${identifier(table)} WHERE ${filter} = ? LIMIT 1`;
    return this.connection().prepare(sql).get(encode(filterValue)) !== undefined;
  }

  public async delete(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<number> {
    const filter = this.column(this.definition(table), filterKey);
    const sql = `DELETE FROM ${identifier(table)} WHERE ${filter} = ?`;
    return Number(this.connection().prepare(sql).run(encode(filterValue)).changes);
  }

  public async findOne(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<DbItem | null> {
    const definition = this.definition(table);
    const filter = this.column(definition, filterKey);
    const sql = `SELECT * FROM ${identifier(table)} WHERE ${filter} = ? LIMIT 1`;
    const row = this.connection().prepare(sql).get(encode(filterValue));
    return row ? this.decode(definition, row) : null;
  }

  public async findMany(table: string, filterKey: string, filterValue: DbPrimitiveValue, pagination: PaginationParams): Promise<DbItem[]> {
    const definition = this.definition(table);
    const { get, skip = 0 } = pagination;
    if (!Number.isSafeInteger(skip) || skip < 0 || (get !== undefined && (!Number.isSafeInteger(get) || get < 0))) {
      throw new RangeError('SQLite pagination expects non-negative integers');
    }

    const filter = this.column(definition, filterKey);
    const order: string[] = [];
    if (definition.fields.created === 'Date') {
      order.push('"created" DESC');
    }
    if (definition.key && definition.key !== 'created') {
      order.push(identifier(definition.key));
    }
    const orderBy = order.length ? ` ORDER BY ${order.join(', ')}` : '';
    const sql = `SELECT * FROM ${identifier(table)} WHERE ${filter} = ?${orderBy} LIMIT ? OFFSET ?`;
    return this.connection()
      .prepare(sql)
      .all(encode(filterValue), get ?? -1, skip)
      .map((row) => this.decode(definition, row));
  }

  public async findAll(table: string): Promise<DbItem[]> {
    const definition = this.definition(table);
    return this.connection()
      .prepare(`SELECT * FROM ${identifier(table)}`)
      .all()
      .map((row) => this.decode(definition, row));
  }

  public async findAllSince(table: string, since: Date): Promise<DbItem[]> {
    const definition = this.definition(table);
    if (definition.fields.lastModified !== 'Date') {
      return [];
    }
    return this.connection()
      .prepare(`SELECT * FROM ${identifier(table)} WHERE "lastModified" >= ?`)
      .all(encode(since))
      .map((row) => this.decode(definition, row));
  }

  private connection(): DatabaseSync {
    if (!this.database) {
      throw new Error('SQLite database is not open');
    }
    return this.database;
  }

  private definition(table: string): DbTableDefinition {
    const definition = this.definitions.get(table);
    if (!definition) {
      throw new Error(`SQLite table is not initialized: ${table}`);
    }
    return definition;
  }

  private column({ table, fields }: DbTableDefinition, field: string): string {
    if (!Object.prototype.hasOwnProperty.call(fields, field)) {
      throw new Error(`Unknown SQLite column: ${table}.${field}`);
    }
    return identifier(field);
  }

  private decode({ fields }: DbTableDefinition, row: unknown): DbItem {
    const values = row as Record<string, unknown>;
    const entries: [string, DbValue][] = [];
    for (const [field, type] of Object.entries(fields)) {
      const value = values[field];
      if (type === 'Date' && typeof value === 'number') {
        entries.push([field, new Date(value)]);
      } else if (type === 'boolean' && typeof value === 'number') {
        entries.push([field, value !== 0]);
      } else if (type === 'object' && typeof value === 'string') {
        entries.push([field, JSON.parse(value)]);
      } else if (typeof value === 'string' || typeof value === 'number') {
        entries.push([field, value]);
      }
    }
    return Object.fromEntries(entries);
  }
}

export { SqliteDatabaseAdapter };
