import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { Comment } from '@/domain/Comment';
import { User } from '@/domain/User';
import { UserService } from '@/service/UserService';
import { verifyPassword } from '@/util/password';

describe('UserService', () => {
  const user: User = {
    userId: 'u1',
    username: 'alice',
    displayName: 'Alice',
    loginHash: Buffer.from('client-login-hash').toString('base64'),
    passwordKeySalt: 'old-salt',
    userKey: 'old-key',
    admin: false,
    editor: false,
    moderator: false
  };
  const otherUser: User = { ...user, userId: 'u2', username: 'bob' };
  const userId = user.userId;
  const comment: Comment = {
    commentId: 'c1',
    videoId: 'v1',
    userId,
    content: 'Original comment',
    created: new Date(100),
    lastModified: new Date(100),
    edited: false,
    deleted: false,
    hmac: 'comment-hmac'
  };
  let db: InMemoryDatabaseAdapter;
  let service: UserService;

  beforeEach(() => {
    db = new InMemoryDatabaseAdapter();
    service = new UserService(db);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createUser', () => {
    test('hashes the client loginHash and passes the remaining account data unchanged to the database', async () => {
      const create = jest.spyOn(db, 'createUser').mockResolvedValue(undefined);

      await expect(service.createUser(user)).resolves.toBeUndefined();

      expect(create).toHaveBeenCalledTimes(1);
      const stored = create.mock.calls[0][0];
      expect(stored).toEqual({ ...user, loginHash: expect.stringMatching(/^\$scrypt\$/) });
      expect(await verifyPassword(user.loginHash, stored.loginHash)).toBe(true);
      expect(user.loginHash).toBe(Buffer.from('client-login-hash').toString('base64'));
    });

    test('rejects duplicate usernames without changing the existing user', async () => {
      await service.createUser(user);
      const original = await service.findUser({ userId });

      await expect(service.createUser({ ...user, userId: 'duplicate', displayName: 'Duplicate' })).rejects.toThrow();

      expect(await service.findAllUsers()).toEqual([original]);
    });

    test('propagates database errors', async () => {
      const error = new Error('Database unavailable');
      jest.spyOn(db, 'createUser').mockRejectedValueOnce(error);

      await expect(service.createUser(user)).rejects.toBe(error);
    });
  });

  describe('deleteUser', () => {
    test('marks comments as deleted before deleting the user', async () => {
      const mark = jest.spyOn(db, 'markCommentsAsDeletedByUserId').mockResolvedValue(undefined);
      const remove = jest.spyOn(db, 'deleteUserByUserId').mockResolvedValue(undefined);

      await expect(service.deleteUser({ userId })).resolves.toBeUndefined();

      expect(mark).toHaveBeenCalledTimes(1);
      expect(mark).toHaveBeenCalledWith({ userId });
      expect(remove).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith({ userId });
      expect(mark.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
    });

    test('keeps the user when marking comments fails and propagates the error', async () => {
      await db.createUser(user);
      const error = new Error('Cannot mark comments');
      jest.spyOn(db, 'markCommentsAsDeletedByUserId').mockRejectedValueOnce(error);
      const remove = jest.spyOn(db, 'deleteUserByUserId');

      await expect(service.deleteUser({ userId })).rejects.toBe(error);

      expect(remove).not.toHaveBeenCalled();
      expect(await db.findOneUserByUserId({ userId })).toEqual(user);
    });

    test('propagates a user deletion failure while leaving comments marked as deleted', async () => {
      await db.createUser(user);
      await db.postComment(comment);
      const error = new Error('Cannot delete user');
      jest.spyOn(db, 'deleteUserByUserId').mockRejectedValueOnce(error);

      await expect(service.deleteUser({ userId })).rejects.toBe(error);

      expect(await db.findOneUserByUserId({ userId })).toEqual(user);
      expect(await db.findOneCommentByCommentId({ commentId: comment.commentId })).toEqual({ ...comment, deleted: true, content: '' });
    });

    test('deletes only the requested user and clears their comments across videos', async () => {
      await db.createUser(user);
      await db.createUser(otherUser);
      await db.postComment(comment);
      await db.postComment({ ...comment, commentId: 'c2', videoId: 'v2' });
      const otherComment = { ...comment, commentId: 'c3', userId: otherUser.userId };
      await db.postComment(otherComment);

      await service.deleteUser({ userId });

      expect(await db.findOneUserByUserId({ userId })).toBeNull();
      expect(await db.findOneUserByUserId({ userId: otherUser.userId })).toEqual(otherUser);
      expect(await db.findOneCommentByCommentId({ commentId: 'c1' })).toEqual({ ...comment, deleted: true, content: '' });
      expect(await db.findOneCommentByCommentId({ commentId: 'c2' })).toEqual({ ...comment, commentId: 'c2', videoId: 'v2', deleted: true, content: '' });
      expect(await db.findOneCommentByCommentId({ commentId: 'c3' })).toEqual(otherComment);
      await expect(service.deleteUser({ userId })).resolves.toBeUndefined();
    });

    test('succeeds when the user and their comments do not exist', async () => {
      await expect(service.deleteUser({ userId: 'missing' })).resolves.toBeUndefined();
    });
  });

  test('changeUsersDisplayName forwards the update to the database', async () => {
    const update = jest.spyOn(db, 'changeUsersDisplayNameByUserId').mockResolvedValue(undefined);
    const parameters = { userId, displayName: 'New display name' };

    await expect(service.changeUsersDisplayName(parameters)).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(parameters);
  });

  test('changeUsersUsername forwards the update to the database', async () => {
    const update = jest.spyOn(db, 'changeUsersUsernameByUserId').mockResolvedValue(undefined);
    const parameters = { userId, username: 'new-alice' };

    await expect(service.changeUsersUsername(parameters)).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(parameters);
  });

  test('changeUsersPassword hashes the new loginHash and forwards the remaining password attributes unchanged', async () => {
    const update = jest.spyOn(db, 'changeUsersPasswordByUserId').mockResolvedValue(undefined);
    const parameters = { userId, loginHash: Buffer.from('new-client-login-hash').toString('base64'), passwordKeySalt: 'new-salt', userKey: 'new-key' };

    await expect(service.changeUsersPassword(parameters)).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledTimes(1);
    const stored = update.mock.calls[0][0];
    expect(stored).toEqual({ ...parameters, loginHash: expect.stringMatching(/^\$scrypt\$/) });
    expect(await verifyPassword(parameters.loginHash, stored.loginHash)).toBe(true);
    expect(parameters.loginHash).toBe(Buffer.from('new-client-login-hash').toString('base64'));
  });

  test.each([true, false])('changeUsersAdminRole forwards the role flag %s', async (enabled) => {
    const update = jest.spyOn(db, 'changeUsersAdminRoleByUserId').mockResolvedValue(undefined);
    const parameters = { userId, admin: enabled };

    await expect(service.changeUsersAdminRole(parameters)).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(parameters);
  });

  test.each([true, false])('changeUsersEditorRole forwards the role flag %s', async (enabled) => {
    const update = jest.spyOn(db, 'changeUsersEditorRoleByUserId').mockResolvedValue(undefined);
    const parameters = { userId, editor: enabled };

    await expect(service.changeUsersEditorRole(parameters)).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(parameters);
  });

  test.each([true, false])('changeUsersModeratorRole forwards the role flag %s', async (enabled) => {
    const update = jest.spyOn(db, 'changeUsersModeratorRoleByUserId').mockResolvedValue(undefined);
    const parameters = { userId, moderator: enabled };

    await expect(service.changeUsersModeratorRole(parameters)).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(parameters);
  });

  test('changeUsersUsername rejects an existing username without changing either user', async () => {
    await db.createUser(user);
    await db.createUser(otherUser);

    await expect(service.changeUsersUsername({ userId, username: otherUser.username })).rejects.toThrow();

    expect(await service.findAllUsers()).toEqual([user, otherUser]);
  });

  test.each([
    ['changeUsersDisplayName', 'changeUsersDisplayNameByUserId'],
    ['changeUsersUsername', 'changeUsersUsernameByUserId'],
    ['changeUsersPassword', 'changeUsersPasswordByUserId'],
    ['changeUsersAdminRole', 'changeUsersAdminRoleByUserId'],
    ['changeUsersEditorRole', 'changeUsersEditorRoleByUserId'],
    ['changeUsersModeratorRole', 'changeUsersModeratorRoleByUserId']
  ] as const)('%s propagates database errors', async (method, dbMethod) => {
    const error = new Error('Database unavailable');
    jest.spyOn(db, dbMethod).mockRejectedValueOnce(error);
    const parameters = { userId, displayName: 'New display name', username: 'new-alice', loginHash: 'new-hash', passwordKeySalt: 'new-salt', userKey: 'new-key', admin: true, editor: true, moderator: true };

    await expect(service[method](parameters)).rejects.toBe(error);
  });

  describe('findUser', () => {
    test.each([
      ['found', user],
      ['missing', null]
    ] as const)('returns a %s user result', async (_label, result) => {
      const find = jest.spyOn(db, 'findOneUserByUserId').mockResolvedValueOnce(result);
      const parameters = { userId };

      await expect(service.findUser(parameters)).resolves.toBe(result);

      expect(find).toHaveBeenCalledTimes(1);
      expect(find).toHaveBeenCalledWith(parameters);
    });

    test('propagates database errors', async () => {
      const error = new Error('Database unavailable');
      jest.spyOn(db, 'findOneUserByUserId').mockRejectedValueOnce(error);

      await expect(service.findUser({ userId })).rejects.toBe(error);
    });
  });

  describe('findAllUsers', () => {
    test.each([[[]], [[user, otherUser]]])('returns the database result %j', async (result) => {
      const find = jest.spyOn(db, 'findAllUsers').mockResolvedValueOnce(result);

      await expect(service.findAllUsers()).resolves.toBe(result);

      expect(find).toHaveBeenCalledTimes(1);
      expect(find).toHaveBeenCalledWith();
    });

    test('propagates database errors', async () => {
      const error = new Error('Database unavailable');
      jest.spyOn(db, 'findAllUsers').mockRejectedValueOnce(error);

      await expect(service.findAllUsers()).rejects.toBe(error);
    });
  });
});
