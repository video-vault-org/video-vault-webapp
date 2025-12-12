interface DbTableDefinition {
  table: string;
  fields: Record<string, string>;
  key: string;
}

export { DbTableDefinition };
