import { DbFieldDefinition } from './DbFieldDefinition';

interface DbTableDefinition {
  table: string;
  fields: DbFieldDefinition;
  key: string;
}

export { DbTableDefinition };
