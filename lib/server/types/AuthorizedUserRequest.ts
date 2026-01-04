import { Request } from './Request';
import { User } from '@/user/types/User';

type AuthorizedUserRequest = Request & { authorizedUser: User };

export { AuthorizedUserRequest };
