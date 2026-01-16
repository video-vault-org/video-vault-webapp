interface PostgresqlDatabaseConf {
  host: string;
  port: number;
  database: string;
  user?: string;
  password?: string;
}

export { PostgresqlDatabaseConf };
