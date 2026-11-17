import { MongoDatabaseConf } from './MongoDatabaseConf';
import { PostgresqlDatabaseConf } from './PostgresqlDatabaseConf';
import { SqliteDatabaseConf } from './SqliteDatabaseConf';

interface DatabaseConfigInMemory {
  type: 'in-memory';
}

interface DatabaseConfigMongo {
  type: 'mongo';
  conf: MongoDatabaseConf;
}

interface DatabaseConfigPostgresql {
  type: 'postgresql';
  conf: PostgresqlDatabaseConf;
}

interface DatabaseConfigSqlite {
  type: 'sqlite';
  conf: SqliteDatabaseConf;
}

type DatabaseConfig = DatabaseConfigInMemory | DatabaseConfigMongo | DatabaseConfigPostgresql | DatabaseConfigSqlite;

export { DatabaseConfig };
