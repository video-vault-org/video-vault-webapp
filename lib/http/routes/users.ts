import { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { User } from '@/domain/User';
import { AuthService } from '@/service/AuthService';
import { UserService } from '@/service/UserService';
import { authorization, currentUser } from '../middleware';
import { HttpError } from '../errors';
import { Type, object, id, text, password, passwordProperties, user as userSchema, errorResponses, noContent } from '../validation';

function publicUser({ loginHash: _loginHash, ...user }: User): Omit<User, 'loginHash'> {
  return user;
}

/** Registers user routes; the parent authenticates /api requests before parsing or validation. */
function userRoutes(app: FastifyInstance, users: UserService, auth: AuthService): void {
  const router = app.withTypeProvider<TypeBoxTypeProvider>();
  const admin = authorization(auth, ['admin']);
  const userParams = object({ userId: id });
  const creation = object({ ...passwordProperties, userId: id, username: text, displayName: text, admin: Type.Boolean({ default: false }), editor: Type.Boolean({ default: false }), moderator: Type.Boolean({ default: false }) });
  const requireUser = async (userId: string) => {
    const user = await users.findUser({ userId });
    if (!user) throw new HttpError(404, 'User not found');
    return user;
  };

  /** POST /api/user/add — Admins only. Creates a user; loginHash is excluded from the response schema. */
  router.post('/add', { onRequest: admin, schema: { body: creation, response: { 201: userSchema, ...errorResponses } } }, async (request, reply) => {
    if (await users.findUser({ userId: request.body.userId })) throw new HttpError(409, 'User already exists');
    await users.createUser(request.body);
    return reply.code(201).send(publicUser(request.body));
  });

  /** GET /api/user/me — Any authenticated user. Returns their current account without loginHash. */
  router.get('/me', { schema: { response: { 200: userSchema, ...errorResponses } } }, async (request) => publicUser(currentUser(request)));

  /** GET /api/user/all — Admins only. Lists users without loginHash. */
  router.get('/all', { onRequest: admin, schema: { response: { 200: Type.Array(userSchema), ...errorResponses } } }, async () => (await users.findAllUsers()).map(publicUser));

  /** GET /api/user/find/:userId — Admins only. Returns a user without loginHash, or 404. */
  router.get('/find/:userId', { onRequest: admin, schema: { params: userParams, response: { 200: userSchema, ...errorResponses } } }, async (request) => publicUser(await requireUser(request.params.userId)));

  /** PATCH /api/user/change/displayname/:userId/:displayname — Admins only. Changes another user's display name. */
  router.patch('/change/displayname/:userId/:displayname', { onRequest: admin, schema: { params: object({ userId: id, displayname: text }), response: noContent } }, async (request, reply) => {
    const { userId, displayname: displayName } = request.params;
    await requireUser(userId);
    await users.changeUsersDisplayName({ userId, displayName });
    return reply.code(204).send(null);
  });

  /** PATCH /api/user/change/displayname/:displayname — Any authenticated user. Changes their own display name. */
  router.patch('/change/displayname/:displayname', { schema: { params: object({ displayname: text }), response: noContent } }, async (request, reply) => {
    await users.changeUsersDisplayName({ userId: currentUser(request).userId, displayName: request.params.displayname });
    return reply.code(204).send(null);
  });

  /** PATCH /api/user/change/username/:userId/:username — Admins only. Changes another user's username. */
  router.patch('/change/username/:userId/:username', { onRequest: admin, schema: { params: object({ userId: id, username: text }), response: noContent } }, async (request, reply) => {
    await requireUser(request.params.userId);
    await users.changeUsersUsername(request.params);
    return reply.code(204).send(null);
  });

  /** PATCH /api/user/change/username/:username — Any authenticated user. Changes their own username. */
  router.patch('/change/username/:username', { schema: { params: object({ username: text }), response: noContent } }, async (request, reply) => {
    await users.changeUsersUsername({ userId: currentUser(request).userId, username: request.params.username });
    return reply.code(204).send(null);
  });

  /** PATCH /api/user/change/password/:userId — Admins only. Changes another user's password attributes. */
  router.patch('/change/password/:userId', { onRequest: admin, schema: { params: userParams, body: password, response: noContent } }, async (request, reply) => {
    await requireUser(request.params.userId);
    await users.changeUsersPassword({ ...request.params, ...request.body });
    return reply.code(204).send(null);
  });

  /** PATCH /api/user/change/password — Any authenticated user. Changes their own password attributes. */
  router.patch('/change/password', { schema: { body: password, response: noContent } }, async (request, reply) => {
    await users.changeUsersPassword({ userId: currentUser(request).userId, ...request.body });
    return reply.code(204).send(null);
  });

  /** PATCH /api/user/change/admin/:userId — Admins only. Changes the admin flag. */
  router.patch('/change/admin/:userId', { onRequest: admin, schema: { params: userParams, body: object({ admin: Type.Boolean() }), response: noContent } }, async (request, reply) => {
    await requireUser(request.params.userId);
    await users.changeUsersAdminRole({ ...request.params, ...request.body });
    return reply.code(204).send(null);
  });

  /** PATCH /api/user/change/editor/:userId — Admins only. Changes the editor flag. */
  router.patch('/change/editor/:userId', { onRequest: admin, schema: { params: userParams, body: object({ editor: Type.Boolean() }), response: noContent } }, async (request, reply) => {
    await requireUser(request.params.userId);
    await users.changeUsersEditorRole({ ...request.params, ...request.body });
    return reply.code(204).send(null);
  });

  /** PATCH /api/user/change/moderator/:userId — Admins only. Changes the moderator flag. */
  router.patch('/change/moderator/:userId', { onRequest: admin, schema: { params: userParams, body: object({ moderator: Type.Boolean() }), response: noContent } }, async (request, reply) => {
    await requireUser(request.params.userId);
    await users.changeUsersModeratorRole({ ...request.params, ...request.body });
    return reply.code(204).send(null);
  });

  /** DELETE /api/user/delete/:userId — Admins only. Clears comments, then deletes the user. */
  router.delete('/delete/:userId', { onRequest: admin, schema: { params: userParams, response: noContent } }, async (request, reply) => {
    await requireUser(request.params.userId);
    await users.deleteUser(request.params);
    return reply.code(204).send(null);
  });

  /** DELETE /api/user/delete — Any authenticated user. Clears their comments, then deletes their own account. */
  router.delete('/delete', { schema: { response: noContent } }, async (request, reply) => {
    await users.deleteUser({ userId: currentUser(request).userId });
    return reply.code(204).send(null);
  });
}
export { userRoutes };
