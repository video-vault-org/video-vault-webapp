import { RequestHandler, Response } from 'express';
import { AuthService } from '@/service/AuthService';
import { User } from '@/domain/User';
import { HttpError } from './errors';

/**
 * Authenticates a Bearer JWT and stores the current database user in response.locals.user.
 * Missing or invalid credentials yield 401; service failures reach the central error handler.
 * @param auth The authentication service used to verify tokens.
 */
function authentication(auth: Pick<AuthService, 'authenticate'>): RequestHandler {
  return async (request, response, next) => {
    const token = request.headers.authorization?.replace(/^bearer /i, '') ?? '';
    const user = token ? await auth.authenticate({ token }) : null;
    if (!user) {
      response.set('WWW-Authenticate', 'Bearer');
      throw new HttpError(401, 'Authentication required');
    }
    response.locals.user = user;
    next();
  };
}

/**
 * Requires at least one of the supplied roles on the authenticated user.
 * Roles are independent: an admin is not implicitly an editor or moderator.
 * @param auth The service that evaluates the user's current role flags.
 * @param roles The roles allowed to access the route.
 */
function authorization(auth: Pick<AuthService, 'authorize'>, roles: ('admin' | 'editor' | 'moderator')[]): RequestHandler {
  return (_request, response, next) => {
    const enabled = auth.authorize(currentUser(response));
    if (!roles.some((role) => enabled.includes(role))) {
      throw new HttpError(403, 'Insufficient permissions');
    }
    next();
  };
}

/** Returns the user set by authentication, or rejects unauthenticated access with 401. */
function currentUser(response: Response): User {
  const user = response.locals.user as User | undefined;
  if (!user) throw new HttpError(401, 'Authentication required');
  return user;
}

export { authentication, authorization, currentUser };
