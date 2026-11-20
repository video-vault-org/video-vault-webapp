import { Router } from 'express';
import { z } from 'zod';
import { User } from '@/domain/User';
import { AuthService } from '@/service/AuthService';
import { UserService } from '@/service/UserService';
import { authorization, currentUser } from '../middleware';
import { HttpError } from '../errors';
import { id, text, password } from '../validation';

function publicUser({ loginHash: _loginHash, ...user }: User): Omit<User, 'loginHash'> {
  return user;
}

/** Builds user routes; the parent router must authenticate every request first. */
function userRoutes(users: UserService, auth: AuthService): Router {
  const router = Router();
  const admin = authorization(auth, ['admin']);
  const creation = password.extend({ userId: id, username: text, displayName: text, admin: z.boolean().default(false), editor: z.boolean().default(false), moderator: z.boolean().default(false) }).strict();
  const requireUser = async (userId: string) => {
    const user = await users.findUser({ userId });
    if (!user) throw new HttpError(404, 'User not found');
    return user;
  };

  /** POST /api/user/add — Admins only. Creates a user with the supplied ID; never returns loginHash. */
  router.post('/add', admin, async (request, response) => {
    const user = creation.parse(request.body);
    if (await users.findUser({ userId: user.userId })) throw new HttpError(409, 'User already exists');
    await users.createUser(user);
    response.status(201).json(publicUser(user));
  });

  /** GET /api/user/me — Any authenticated user. Returns their own user without loginHash. */
  router.get('/me', (_request, response) => {
    response.json(publicUser(currentUser(response)));
  });

  /** GET /api/user/all — Admins only. Lists all users without loginHash. */
  router.get('/all', admin, async (_request, response) => {
    response.json((await users.findAllUsers()).map(publicUser));
  });

  /** GET /api/user/find/:userId — Admins only. Returns one user without loginHash, or 404. */
  router.get('/find/:userId', admin, async (request, response) => {
    response.json(publicUser(await requireUser(id.parse(request.params.userId))));
  });

  /** PATCH /api/user/change/displayname/:userId/:displayname — Admins only. Changes another user's display name. */
  router.patch('/change/displayname/:userId/:displayname', admin, async (request, response) => {
    const userId = id.parse(request.params.userId);
    const displayName = text.parse(request.params.displayname);
    await requireUser(userId);
    await users.changeUsersDisplayName({ userId, displayName });
    response.sendStatus(204);
  });

  /** PATCH /api/user/change/displayname/:displayname — Any authenticated user. Changes only their own display name. */
  router.patch('/change/displayname/:displayname', async (request, response) => {
    await users.changeUsersDisplayName({ userId: currentUser(response).userId, displayName: text.parse(request.params.displayname) });
    response.sendStatus(204);
  });

  /** PATCH /api/user/change/username/:userId/:username — Admins only. Changes another user's username. */
  router.patch('/change/username/:userId/:username', admin, async (request, response) => {
    const userId = id.parse(request.params.userId);
    const username = text.parse(request.params.username);
    await requireUser(userId);
    await users.changeUsersUsername({ userId, username });
    response.sendStatus(204);
  });

  /** PATCH /api/user/change/username/:username — Any authenticated user. Changes only their own username. */
  router.patch('/change/username/:username', async (request, response) => {
    await users.changeUsersUsername({ userId: currentUser(response).userId, username: text.parse(request.params.username) });
    response.sendStatus(204);
  });

  /** PATCH /api/user/change/password/:userId — Admins only. JSON body: loginHash, passwordKeySalt, userKey. */
  router.patch('/change/password/:userId', admin, async (request, response) => {
    const userId = id.parse(request.params.userId);
    const attributes = password.parse(request.body);
    await requireUser(userId);
    await users.changeUsersPassword({ userId, ...attributes });
    response.sendStatus(204);
  });

  /** PATCH /api/user/change/password — Any authenticated user. Changes only their own password attributes. */
  router.patch('/change/password', async (request, response) => {
    await users.changeUsersPassword({ userId: currentUser(response).userId, ...password.parse(request.body) });
    response.sendStatus(204);
  });

  /** PATCH /api/user/change/admin/:userId — Admins only. JSON body: { admin: boolean }. */
  router.patch('/change/admin/:userId', admin, async (request, response) => {
    const userId = id.parse(request.params.userId);
    const { admin } = z.object({ admin: z.boolean() }).strict().parse(request.body);
    await requireUser(userId);
    await users.changeUsersAdminRole({ userId, admin });
    response.sendStatus(204);
  });

  /** PATCH /api/user/change/editor/:userId — Admins only. JSON body: { editor: boolean }. */
  router.patch('/change/editor/:userId', admin, async (request, response) => {
    const userId = id.parse(request.params.userId);
    const { editor } = z.object({ editor: z.boolean() }).strict().parse(request.body);
    await requireUser(userId);
    await users.changeUsersEditorRole({ userId, editor });
    response.sendStatus(204);
  });

  /** PATCH /api/user/change/moderator/:userId — Admins only. JSON body: { moderator: boolean }. */
  router.patch('/change/moderator/:userId', admin, async (request, response) => {
    const userId = id.parse(request.params.userId);
    const { moderator } = z.object({ moderator: z.boolean() }).strict().parse(request.body);
    await requireUser(userId);
    await users.changeUsersModeratorRole({ userId, moderator });
    response.sendStatus(204);
  });

  /** DELETE /api/user/delete/:userId — Admins only. Clears the user's comment content, then deletes the user. */
  router.delete('/delete/:userId', admin, async (request, response) => {
    const userId = id.parse(request.params.userId);
    await requireUser(userId);
    await users.deleteUser({ userId });
    response.sendStatus(204);
  });

  /** DELETE /api/user/delete — Any authenticated user. Clears their comment content, then deletes their own account. */
  router.delete('/delete', async (_request, response) => {
    await users.deleteUser({ userId: currentUser(response).userId });
    response.sendStatus(204);
  });
  return router;
}

export { userRoutes };
