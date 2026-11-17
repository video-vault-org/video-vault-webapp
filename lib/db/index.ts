import { readFile, writeFile } from 'fs/promises';
import { DatabaseConfig } from '@/db/config/DatabaseConfig';
import { DatabaseAdapter } from '@/db/adapters/DatabaseAdapter';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { MongoDatabaseAdapter } from '@/db/adapters/MongoDatabaseAdapter';
import { PostgresqlDatabaseAdapter } from '@/db/adapters/PostgresqlDatabaseAdapter';
import { SQLiteDatabaseAdapter } from '@/db/adapters/SQLiteDatabaseAdapter';

let db: DatabaseAdapter | null;

const init = async function (): Promise<void> {
  await db?.open();
  await db?.initialize();
};

const saveConfig = async function (config: DatabaseConfig) {
  await writeFile('./conf/db.json', JSON.stringify(config, null, 4), 'utf8');
  await resetDb();
};

const loadConfig = async function (): Promise<DatabaseConfig | null> {
  try {
    const config = await readFile('./conf/db.json', 'utf8');
    if (!config) {
      return null;
    }
    return JSON.parse(config);
  } catch (err: unknown) {
    return null;
  }
};

const loadDb = async function (): Promise<DatabaseAdapter> {
  if (db) {
    return db;
  }

  const config = JSON.parse(await readFile('./conf/db.json', 'utf8'));

  if (config.type === 'mongo') {
    db = new MongoDatabaseAdapter(config.conf);
  } else if (config.type === 'postgresql') {
    db = new PostgresqlDatabaseAdapter(config.conf);
  } else if (config.type === 'sqlite') {
    db = new SQLiteDatabaseAdapter(config.conf);
  } else {
    db = new InMemoryDatabaseAdapter();
  }

  await init();

  return db;
};

const resetDb = async function () {
  await db?.close();
  db = null;
};

export { saveConfig, loadConfig, loadDb, resetDb };
