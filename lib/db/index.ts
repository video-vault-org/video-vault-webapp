import { DatabaseConfig } from '@/db/types/DatabaseConfig';
import { LocalStorageAdapter } from '@/storage/adapters/LocalStorageAdapter';
import { DatabaseAdapter } from '@/db/types/DatabaseAdapter';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { MongoDatabaseAdapter } from '@/db/adapters/MongoDatabaseAdapter';
import { PostgresqlDatabaseAdapter } from '@/db/adapters/PostgresqlDatabaseAdapter';
import { tables } from './tables';

let db: DatabaseAdapter | null;

const init = async function (): Promise<void> {
  await db?.open();
  for (const tableDefinition of tables) {
    await db?.init(tableDefinition);
  }
};

const saveConfig = async function (config: DatabaseConfig) {
  const configBuffer = Buffer.from(JSON.stringify(config), 'utf8');
  await new LocalStorageAdapter({ basePath: './conf' }).save('db.json', configBuffer);
  await resetDb();
};

const loadDb = async function (): Promise<DatabaseAdapter> {
  if (db) {
    return db;
  }

  const configBuffer = await new LocalStorageAdapter({ basePath: './conf' }).read('db.json');
  const config: DatabaseConfig = JSON.parse(configBuffer?.toString('utf8') ?? '{}');

  if (config.type === 'mongo') {
    db = new MongoDatabaseAdapter(config.conf);
  } else if (config.type === 'postgresql') {
    db = new PostgresqlDatabaseAdapter(config.conf);
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

export { saveConfig, loadDb, resetDb };
