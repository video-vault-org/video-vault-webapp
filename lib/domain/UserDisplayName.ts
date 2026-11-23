import { User } from './User';

/** Public name projection; contains no credentials, keys or roles. */
type UserDisplayName = Pick<User, 'userId' | 'displayName'>;

export { UserDisplayName };
