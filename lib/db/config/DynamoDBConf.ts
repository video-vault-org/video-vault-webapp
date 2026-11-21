interface DynamoDBConf {
  region?: string;
  endpoint?: string;
  /** Overrides the prefix derived from the application title when supplied. */
  tablePrefix?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

export { DynamoDBConf };
