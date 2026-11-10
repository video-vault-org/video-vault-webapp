import { MongoDatabaseConf } from './MongoDatabaseConf';
import { PostgresqlDatabaseConf } from './PostgresqlDatabaseConf';

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

type DatabaseConfig = DatabaseConfigInMemory | DatabaseConfigMongo | DatabaseConfigPostgresql;

export { DatabaseConfig };
