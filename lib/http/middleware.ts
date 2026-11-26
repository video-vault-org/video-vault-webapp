import { onRequestAsyncHookHandler, FastifyRequest } from 'fastify';
import { AuthService, AuthenticatedSession } from '@/service/AuthService';
import { User } from '@/domain/User';
import { HttpError } from './errors';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    failure: Error | null;
    authSession: AuthenticatedSession | null;
    sessionId: string;
  }
}

/** Authenticates an opaque cookie credential before body parsing and loads the current database user. */
const authentication = function (auth: Pick<AuthService, 'findSession'>, cookies: { credential: (request: FastifyRequest) => string; clear: (reply: import('fastify').FastifyReply) => void }): onRequestAsyncHookHandler {
  return async (request, reply) => {
    request.sessionId = cookies.credential(request);
    request.authSession = request.sessionId ? await auth.findSession({ sessionId: request.sessionId }) : null;
    if (!request.authSession) {
      if (request.sessionId) cookies.clear(reply);
      throw new HttpError(401, 'Authentication required');
    }
    request.user = request.authSession.user;
  };
};

/** Requires any supplied role. Admin, editor and moderator privileges remain independent. */
const authorization = function (auth: Pick<AuthService, 'authorize'>, roles: ('admin' | 'editor' | 'moderator')[]): onRequestAsyncHookHandler & { requiredRoles: readonly ('admin' | 'editor' | 'moderator')[] } {
  const hook: onRequestAsyncHookHandler = async (request) => {
    if (!roles.some((role) => auth.authorize(currentUser(request)).includes(role))) throw new HttpError(403, 'Insufficient permissions');
  };

  return Object.assign(hook, { requiredRoles: [...roles] });
};

/** Returns the authenticated user, or rejects access with HTTP 401. */
const currentUser = function (request: FastifyRequest): User {
  if (!request.user) throw new HttpError(401, 'Authentication required');
  return request.user;
};

export { authentication, authorization, currentUser };
