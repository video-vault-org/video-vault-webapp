import { DbItem } from './DbItem';
import { DbLimit } from './DbLimit';
import { DbValue } from './DbValue';
import { DbPrimitiveValue } from './DbPrimitiveValue';
import { DbTableDefinition } from './DbTableDefinition';

/**
 * DatabaseAdapter is used to abstract database operations away from the business logic.
 */
interface DatabaseAdapter {
  /**
   * Opens the database connection.
   */
  open(): Promise<void>;

  /**
   * Closes the database connection.
   */
  close(): Promise<void>;

  /**
   * Creates a new table/collection.
   * @param table The name of the table.
   * @param fields array of field names
   * @param key key field name
   */
  init({ table, fields, key }: DbTableDefinition): Promise<void>;

  /**
   * Adds a new item to the database.
   * @param table The name of the table.
   * @param item The item to add.
   */
  add(table: string, item: DbItem): Promise<void>;

  /**
   * Updates one or more items in the database.
   * @param table The name of the table.
   * @param filterKey The name of the key to filter for.
   * @param filterValue The value to filter for.
   * @param update All props and values for the update
   * @returns Promise of number of updated items
   */
  update(table: string, filterKey: string, filterValue: DbPrimitiveValue, update: Record<string, DbValue>): Promise<number>;

  /**
   * Checks if an item exists in the database.
   * @param table The name of the table.
   * @param filterKey The name of the key to filter for.
   * @param filterValue The value to filter for.
   * @returns Promise fulfilling with a boolean, true and only true, if the item exists.
   */
  exists(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<boolean>;

  /**
   * Deletes one or more items in the database.
   * @param table The name of the table.
   * @param filterKey The name of the key to filter for.
   * @param filterValue The value to filter for.
   * @returns Promise of number of deleted items
   */
  delete(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<number>;

  /**
   * Finds one item in the database.
   * @param table The name of the table.
   * @param filterKey The name of the key to filter for.
   * @param filterValue The value to filter for.
   * @returns Promise fulfilling with the item or with null if item does not exist.
   */
  findOne(table: string, filterKey: string, filterValue: DbPrimitiveValue): Promise<DbItem | null>;

  /**
   * Finds many items in the database.
   * @param table The name of the table.
   * @param filterKey The name of the key to filter for.
   * @param filterValue The value to filter for.
   * @param dbLimit limit params for paging, no paging if not given
   * @returns Promise fulfilling with the item or with null if item does not exist.
   */
  findMany(table: string, filterKey: string, filterValue: DbPrimitiveValue, dbLimit?: DbLimit): Promise<DbItem[]>;

  /**
   * Finds all items of the specified table
   * @param table name of the table
   * @param dbLimit limit params for paging, no paging if not given
   */
  findAll(table: string, dbLimit?: DbLimit): Promise<DbItem[]>;

  /**
   * Finds all items of the specified table, last modified since specified Date.
   * Items without lastModified property won't be found.
   * @param table name of the table
   * @param since Date since you want the items from
   */
  findAllSince(table: string, since: Date): Promise<DbItem[]>;
}

export { DatabaseAdapter };
