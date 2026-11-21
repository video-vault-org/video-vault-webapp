import { readFile, writeFile } from 'fs/promises';
import { DatabaseConfig } from '@/db/config/DatabaseConfig';
import { DatabaseAdapter } from '@/db/adapters/DatabaseAdapter';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { MongoDatabaseAdapter } from '@/db/adapters/MongoDatabaseAdapter';
import { PostgresqlDatabaseAdapter } from '@/db/adapters/PostgresqlDatabaseAdapter';
import { SQLiteDatabaseAdapter } from '@/db/adapters/SQLiteDatabaseAdapter';
import { DynamoDBDatabaseAdapter } from '@/db/adapters/DynamoDBDatabaseAdapter';
import { loadConfig as loadAppConfig } from '@/app';
import { AppConfig, DEFAULT_APP_TITLE } from '@/app/config/AppConfig';

let db: Promise<DatabaseAdapter> | null = null;

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
  } catch {
    return null;
  }
};

const connectDb = async function (appConfig?: AppConfig): Promise<DatabaseAdapter> {
  const config: DatabaseConfig = JSON.parse(await readFile('./conf/db.json', 'utf8'));
  let adapter: DatabaseAdapter;

  if (config.type === 'mongo') {
    adapter = new MongoDatabaseAdapter(config.conf);
  } else if (config.type === 'postgresql') {
    adapter = new PostgresqlDatabaseAdapter(config.conf);
  } else if (config.type === 'sqlite') {
    adapter = new SQLiteDatabaseAdapter(config.conf);
  } else if (config.type === 'dynamodb') {
    adapter = new DynamoDBDatabaseAdapter(config.conf, appConfig?.title ?? (await loadAppConfig())?.title ?? DEFAULT_APP_TITLE);
  } else {
    adapter = new InMemoryDatabaseAdapter();
  }

  try {
    await adapter.open();
    await adapter.initialize();
    return adapter;
  } catch (error) {
    await adapter.close().catch(() => undefined);
    throw error;
  }
};

const loadDb = async function (appConfig?: AppConfig): Promise<DatabaseAdapter> {
  const connection = (db ??= connectDb(appConfig));
  try {
    return await connection;
  } catch (error) {
    if (db === connection) {
      db = null;
    }
    throw error;
  }
};

const resetDb = async function () {
  const connection = db;
  db = null;
  const adapter = await connection?.catch(() => undefined);
  await adapter?.close();
};

export { saveConfig, loadConfig, loadDb, resetDb };
