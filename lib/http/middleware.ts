import { onRequestAsyncHookHandler, FastifyRequest } from 'fastify';
import { AuthService } from '@/service/AuthService';
import { User } from '@/domain/User';
import { HttpError } from './errors';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    failure: Error | null;
  }
}

/** Authenticates the Bearer JWT before body parsing and stores the current database user on request.user. */
function authentication(auth: Pick<AuthService, 'authenticate'>): onRequestAsyncHookHandler {
  return async (request, reply) => {
    const token = request.headers.authorization?.replace(/^bearer /i, '') ?? '';
    const user = token ? await auth.authenticate({ token }) : null;
    if (!user) {
      reply.header('WWW-Authenticate', 'Bearer');
      throw new HttpError(401, 'Authentication required');
    }
    request.user = user;
  };
}

/** Requires any supplied role. Admin, editor and moderator privileges remain independent. */
function authorization(auth: Pick<AuthService, 'authorize'>, roles: ('admin' | 'editor' | 'moderator')[]): onRequestAsyncHookHandler & { requiredRoles: readonly ('admin' | 'editor' | 'moderator')[] } {
  const hook: onRequestAsyncHookHandler = async (request) => {
    if (!roles.some((role) => auth.authorize(currentUser(request)).includes(role))) throw new HttpError(403, 'Insufficient permissions');
  };
  return Object.assign(hook, { requiredRoles: [...roles] });
}

/** Returns the authenticated user, or rejects access with HTTP 401. */
function currentUser(request: FastifyRequest): User {
  if (!request.user) throw new HttpError(401, 'Authentication required');
  return request.user;
}

export { authentication, authorization, currentUser };
