import { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { User } from '@/domain/User';
import { AuthService } from '@/service/AuthService';
import { UserService } from '@/service/UserService';
import { authorization, currentUser } from '../middleware';
import { HttpError } from '../errors';
import { Type, object, id, text, username, passwordProperties, user as userSchema, errorResponses, noContent } from '../validation';

const publicUser = function ({ loginHash: _loginHash, ...user }: User): Omit<User, 'loginHash'> {
  return user;
};

/** Registers user routes; the parent authenticates /api requests before parsing or validation. */
const userRoutes = function (app: FastifyInstance, users: UserService, auth: AuthService): void {
  const router = app.withTypeProvider<TypeBoxTypeProvider>();
  const admin = authorization(auth, ['admin']);
  const userParams = object({ userId: id });
  const creation = object({ oldLoginHash: text, ...passwordProperties, userId: id, username, displayName: text, admin: Type.Boolean({ default: false }), editor: Type.Boolean({ default: false }), moderator: Type.Boolean({ default: false }) });

  const requireUser = async (userId: string) => {
    const user = await users.findUser({ userId });
    if (!user) throw new HttpError(404, 'User not found');
    return user;
  };

  const requireCurrentPassword = async function (userId: string, oldLoginHash: string | undefined): Promise<void> {
    if (oldLoginHash === undefined) throw new HttpError(400, 'Current password proof is required');
    if (!(await auth.verifyCurrentPassword({ userId, loginHash: oldLoginHash }))) throw new HttpError(403, 'Current password is incorrect or temporarily locked');
  };

  /** POST /api/user/add — Admins only. Requires the acting admin’s current oldLoginHash. Creates a user; loginHash is excluded from the response schema. */
  router.post('/add', { onRequest: admin, schema: { body: creation, response: { 201: userSchema, ...errorResponses } } }, async (request, reply) => {
    const { oldLoginHash, ...user } = request.body;
    await requireCurrentPassword(currentUser(request).userId, oldLoginHash);
    if (await users.findUser({ userId: user.userId })) throw new HttpError(409, 'User already exists');
    await users.createUser(user);
    return reply.code(201).send(publicUser(user));
  });

  /** GET /api/user/me — Any authenticated user. Returns their current account without loginHash. */
  router.get('/me', { schema: { response: { 200: userSchema, ...errorResponses } } }, async (request) => publicUser(currentUser(request)));

  /** GET /api/user/all — Admins only. Lists users without loginHash. */
  router.get('/all', { onRequest: admin, schema: { response: { 200: Type.Array(userSchema), ...errorResponses } } }, async () => (await users.findAllUsers()).map(publicUser));

  /** GET /api/user/find/:userId — Admins only. Returns a user without loginHash, or 404. */
  router.get('/find/:userId', { onRequest: admin, schema: { params: userParams, response: { 200: userSchema, ...errorResponses } } }, async (request) => publicUser(await requireUser(request.params.userId)));

  /** PATCH /api/user/change/displayname/:userId/:displayname — Admins only. Requires the acting admin’s current oldLoginHash. Changes another user's display name. */
  router.patch('/change/displayname/:userId/:displayname', { onRequest: admin, schema: { params: object({ userId: id, displayname: text }), body: object({ oldLoginHash: text }), response: noContent } }, async (request, reply) => {
    await requireCurrentPassword(currentUser(request).userId, request.body.oldLoginHash);
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

  /** PATCH /api/user/change/username/:userId/:username — Admins only. Changes another user's username and loginHash together; requires loginHash derived for the new username and oldLoginHash from the acting admin, regardless of the target account. */
  router.patch('/change/username/:userId/:username', { onRequest: admin, schema: { params: object({ userId: id, username }), body: object({ loginHash: text, oldLoginHash: text }), response: noContent } }, async (request, reply) => {
    await requireUser(request.params.userId);
    await requireCurrentPassword(currentUser(request).userId, request.body.oldLoginHash);
    await users.changeUsersUsername({ ...request.params, loginHash: request.body.loginHash });
    return reply.code(204).send(null);
  });

  /** PATCH /api/user/change/username/:username — Any authenticated user. Changes their own username and loginHash together; requires loginHash derived for the new username and oldLoginHash for current-password verification. */
  router.patch('/change/username/:username', { schema: { params: object({ username }), body: object({ loginHash: text, oldLoginHash: text }), response: noContent } }, async (request, reply) => {
    await requireCurrentPassword(currentUser(request).userId, request.body.oldLoginHash);
    await users.changeUsersUsername({ userId: currentUser(request).userId, username: request.params.username, loginHash: request.body.loginHash });
    return reply.code(204).send(null);
  });

  /** POST /api/user/initialize-keys — Authenticated admins only. Requires the acting admin’s current oldLoginHash. Stores the first wrapped keys for their own account once; never changes the login proof. */
  router.post(
    '/initialize-keys',
    {
      onRequest: admin,
      schema: {
        body: object({ oldLoginHash: text, passwordKeySalt: Type.String({ pattern: '^[A-Za-z0-9+/]{43}=$' }), userKey: Type.String({ pattern: '^[A-Za-z0-9+/]{107}=$' }) }),
        response: noContent
      }
    },
    async (request, reply) => {
      const { oldLoginHash, ...attributes } = request.body;
      await requireCurrentPassword(currentUser(request).userId, oldLoginHash);
      await users.initializeUsersKeys({ userId: currentUser(request).userId, ...attributes });
      return reply.code(204).send(null);
    }
  );

  /** PATCH /api/user/change/password/:userId — Admins only. Changes password attributes; oldLoginHash from the acting admin is required, regardless of the target account. */
  router.patch('/change/password/:userId', { onRequest: admin, schema: { params: userParams, body: object({ ...passwordProperties, oldLoginHash: text }), response: noContent } }, async (request, reply) => {
    await requireUser(request.params.userId);
    const { oldLoginHash, ...attributes } = request.body;
    await requireCurrentPassword(currentUser(request).userId, oldLoginHash);
    await users.changeUsersPassword({ ...request.params, ...attributes });
    return reply.code(204).send(null);
  });

  /** PATCH /api/user/change/password — Any authenticated user. Requires oldLoginHash, verified with login lock handling before changing password attributes. */
  router.patch('/change/password', { schema: { body: object({ ...passwordProperties, oldLoginHash: text }), response: noContent } }, async (request, reply) => {
    const userId = currentUser(request).userId;
    const { oldLoginHash, ...attributes } = request.body;
    await requireCurrentPassword(userId, oldLoginHash);
    await users.changeUsersPassword({ userId, ...attributes });
    return reply.code(204).send(null);
  });

  /** PATCH /api/user/change/admin/:userId — Admins only. Requires the acting admin’s current oldLoginHash. Changes the admin flag. */
  router.patch('/change/admin/:userId', { onRequest: admin, schema: { params: userParams, body: object({ admin: Type.Boolean(), oldLoginHash: text }), response: noContent } }, async (request, reply) => {
    await requireCurrentPassword(currentUser(request).userId, request.body.oldLoginHash);
    await requireUser(request.params.userId);
    await users.changeUsersAdminRole({ ...request.params, admin: request.body.admin });
    return reply.code(204).send(null);
  });

  /** PATCH /api/user/change/editor/:userId — Admins only. Requires the acting admin’s current oldLoginHash. Changes the editor flag. */
  router.patch('/change/editor/:userId', { onRequest: admin, schema: { params: userParams, body: object({ editor: Type.Boolean(), oldLoginHash: text }), response: noContent } }, async (request, reply) => {
    await requireCurrentPassword(currentUser(request).userId, request.body.oldLoginHash);
    await requireUser(request.params.userId);
    await users.changeUsersEditorRole({ ...request.params, editor: request.body.editor });
    return reply.code(204).send(null);
  });

  /** PATCH /api/user/change/moderator/:userId — Admins only. Requires the acting admin’s current oldLoginHash. Changes the moderator flag. */
  router.patch('/change/moderator/:userId', { onRequest: admin, schema: { params: userParams, body: object({ moderator: Type.Boolean(), oldLoginHash: text }), response: noContent } }, async (request, reply) => {
    await requireCurrentPassword(currentUser(request).userId, request.body.oldLoginHash);
    await requireUser(request.params.userId);
    await users.changeUsersModeratorRole({ ...request.params, moderator: request.body.moderator });
    return reply.code(204).send(null);
  });

  /** DELETE /api/user/delete/:userId — Admins only. Requires the acting admin’s current oldLoginHash. Clears comments, then deletes the user. */
  router.delete('/delete/:userId', { onRequest: admin, schema: { params: userParams, body: object({ oldLoginHash: text }), response: noContent } }, async (request, reply) => {
    await requireCurrentPassword(currentUser(request).userId, request.body.oldLoginHash);
    await requireUser(request.params.userId);
    await users.deleteUser(request.params);
    return reply.code(204).send(null);
  });

  /** DELETE /api/user/delete — Any authenticated user. Clears their comments, then deletes their own account. */
  router.delete('/delete', { schema: { response: noContent } }, async (request, reply) => {
    await users.deleteUser({ userId: currentUser(request).userId });
    return reply.code(204).send(null);
  });
};

export { userRoutes };
