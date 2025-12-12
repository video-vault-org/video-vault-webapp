import { DbValue } from '@/db/types/DbValue';

interface DbTableDefinition {
  table: string;
  fields: Record<string, DbValue>;
  key: string;
}

export { DbTableDefinition };
