import { Request } from './Request';

type AuthorizedInitRequest = Request & { authorizedInit: boolean };

export { AuthorizedInitRequest };
