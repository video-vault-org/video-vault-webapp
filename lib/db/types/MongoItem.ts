import { DbItem } from './DbItem';

type MongoItem = DbItem & { _id?: unknown };

export { MongoItem };
