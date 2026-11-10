import { DbValue } from './DbValue';

type DbItem = Record<string, DbValue> & { lastModified?: Date, hmac?: string };

export { DbItem };
