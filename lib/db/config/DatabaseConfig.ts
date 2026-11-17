import { DynamoDBConf } from './DynamoDBConf';
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

interface DatabaseConfigDynamoDB {
  type: 'dynamodb';
  conf: DynamoDBConf;
}

type DatabaseConfig = DatabaseConfigInMemory | DatabaseConfigMongo | DatabaseConfigPostgresql | DatabaseConfigSqlite | DatabaseConfigDynamoDB;

export { DatabaseConfig };
