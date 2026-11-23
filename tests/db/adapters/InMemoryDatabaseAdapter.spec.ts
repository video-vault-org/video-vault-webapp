import { DatabaseConflictError } from '@/db/errors/DatabaseConflictError';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { Comment } from '@/domain/Comment';
import { User } from '@/domain/User';
import { Video } from '@/domain/Video';

describe('InMemoryDatabaseAdapter', () => {
  const user: User = {
    userId: 'u1',
    username: 'alice',
    displayName: 'Alice',
    loginHash: 'old-hash',
    passwordKeySalt: 'old-salt',
    userKey: 'old-key',
    admin: false,
    editor: false,
    moderator: false
  };

  const otherUser: User = { ...user, userId: 'u2', username: 'bob' };

  const video: Video = {
    deleted: false,
    videoId: 'v1',
    title: 'Original',
    description: 'Encrypted description',
    meta: { duration: 10 },
    videoMimeType: 'video/mp4',
    thumbnailMimeType: 'image/png',
    recorded: new Date(50),
    lastModified: new Date(100),
    hmac: 'old-hmac'
  };

  const otherVideo: Video = { ...video, videoId: 'v2' };

  const comment: Comment = {
    commentId: 'c1',
    userId: user.userId,
    videoId: video.videoId,
    content: 'Original comment',
    created: new Date(100),
    lastModified: new Date(100),
    edited: false,
    deleted: false,
    hmac: 'old-hmac'
  };

  const modified = { lastModified: new Date(200), hmac: 'new-hmac' };

  let db: InMemoryDatabaseAdapter;

  beforeEach(() => {
    db = new InMemoryDatabaseAdapter();
  });

  test('open sets the connection state', async () => {
    expect(db['opened']).toBeUndefined();

    await db.open();

    expect(db['opened']).toBe(true);
  });

  test('close resets the connection state', async () => {
    await db.open();
    await db.close();

    expect(db['opened']).toBe(false);
  });

  test('initialize clears users, videos, comments and attempt counts', async () => {
    await db.createUser(user);
    await db.postVideo(video);
    await db.postComment(comment);
    await db.increaseAttemptsCountByUsername({ username: user.username, lastAttempt: new Date(100) });

    await db.initialize();

    expect(await db.findAllUsers()).toEqual([]);
    expect(await db.findAllVideos()).toEqual([]);
    expect(await db.findOneCommentByCommentId({ commentId: comment.commentId })).toBeNull();
    expect(await db.findOneAttemptsCountByUsername({ username: user.username })).toBeNull();
  });

  test('initializeUsersKeysByUserId initializes an admin once atomically and preserves the login proof', async () => {
    const pending = { ...user, userId: 'pending-admin', username: 'pending-admin', admin: true, userKey: '', passwordKeySalt: '' };
    await db.createUser(pending);
    const outcomes = await Promise.all([
      db.initializeUsersKeysByUserId({ userId: pending.userId, userKey: 'wrapped-first', passwordKeySalt: 'salt-first' }),
      db.initializeUsersKeysByUserId({ userId: pending.userId, userKey: 'wrapped-second', passwordKeySalt: 'salt-second' })
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const index = outcomes[0] ? 'first' : 'second';
    expect(await db.findOneUserByUserId({ userId: pending.userId })).toEqual({ ...pending, userKey: `wrapped-${index}`, passwordKeySalt: `salt-${index}` });
    expect(await db.initializeUsersKeysByUserId({ userId: pending.userId, userKey: 'replacement', passwordKeySalt: 'replacement' })).toBe(false);
  });

  test('initializeUsersKeysByUserId rejects missing users and uninitialized non-admins', async () => {
    const pending = { ...user, userId: 'pending-reader', username: 'pending-reader', admin: false, userKey: '', passwordKeySalt: '' };
    await db.createUser(pending);
    for (const userId of [pending.userId, 'missing']) {
      expect(await db.initializeUsersKeysByUserId({ userId, userKey: 'wrapped', passwordKeySalt: 'salt' })).toBe(false);
    }
    expect(await db.findOneUserByUserId({ userId: pending.userId })).toEqual(pending);
    expect(await db.findOneUserByUserId({ userId: 'missing' })).toBeNull();
  });

  test('findDisplayNamesByUserIds projects only requested names, deduplicates IDs and omits unknown users', async () => {
    await db.createUser(user);
    await db.createUser({ ...otherUser, displayName: 'Bob' });
    const names = await db.findDisplayNamesByUserIds({ userIds: [user.userId, otherUser.userId, user.userId, "missing' OR 1=1 --"] });
    expect(names.sort((a, b) => a.userId.localeCompare(b.userId))).toEqual(
      [
        { userId: user.userId, displayName: user.displayName },
        { userId: otherUser.userId, displayName: 'Bob' }
      ].sort((a, b) => a.userId.localeCompare(b.userId))
    );
    expect(await db.findDisplayNamesByUserIds({ userIds: [] })).toEqual([]);
  });

  test('findDisplayNamesByUserIds reflects renamed and deleted users without caching', async () => {
    await db.createUser(user);
    await db.changeUsersDisplayNameByUserId({ userId: user.userId, displayName: 'Renamed' });
    expect(await db.findDisplayNamesByUserIds({ userIds: [user.userId] })).toEqual([{ userId: user.userId, displayName: 'Renamed' }]);
    await db.deleteUserByUserId({ userId: user.userId });
    expect(await db.findDisplayNamesByUserIds({ userIds: [user.userId] })).toEqual([]);
  });

  describe('users', () => {
    const { userId, username } = user;

    beforeEach(async () => {
      await db.createUser(user);
      await db.createUser(otherUser);
    });

    test('createUser stores a copy of the given user', async () => {
      const input = { ...user, userId: 'u3', username: 'charlie' };
      await db.createUser(input);
      input.displayName = 'Changed outside adapter';

      expect(await db.findOneUserByUserId({ userId: input.userId })).toEqual({ ...user, userId: 'u3', username: 'charlie' });
    });

    test('changeUsersDisplayNameByUserId updates only the matching user', async () => {
      await db.changeUsersDisplayNameByUserId({ userId: 'missing', displayName: 'Ignored' });
      await db.changeUsersDisplayNameByUserId({ userId, displayName: 'New display name' });

      expect(await db.findAllUsers()).toEqual([{ ...user, displayName: 'New display name' }, otherUser]);
    });

    test('changeUsersUsernameByUserId atomically updates username and loginHash', async () => {
      await db.changeUsersUsernameByUserId({ userId: 'missing', username: 'ignored', loginHash: 'new-hash' });
      await db.changeUsersUsernameByUserId({ userId, username: 'new-name', loginHash: 'new-hash' });

      expect(await db.findOneUserByUsername({ username })).toBeNull();
      expect(await db.findOneUserByUsername({ username: 'new-name' })).toEqual({ ...user, username: 'new-name', loginHash: 'new-hash' });
      expect(await db.findOneUserByUserId({ userId: otherUser.userId })).toEqual(otherUser);
    });

    test('createUser rejects a duplicate username without changing existing users', async () => {
      await expect(db.createUser({ ...otherUser, userId: 'u3', username })).rejects.toBeInstanceOf(DatabaseConflictError);

      expect(await db.findAllUsers()).toEqual([user, otherUser]);
    });

    test('changeUsersUsernameByUserId rejects another user’s username without changing either user', async () => {
      await expect(db.changeUsersUsernameByUserId({ userId: otherUser.userId, username, loginHash: 'new-hash' })).rejects.toBeInstanceOf(DatabaseConflictError);

      expect(await db.findAllUsers()).toEqual([user, otherUser]);
    });

    test('changeUsersUsernameByUserId updates loginHash even when the username is unchanged', async () => {
      await db.changeUsersUsernameByUserId({ userId, username, loginHash: 'new-hash' });

      expect(await db.findAllUsers()).toEqual([{ ...user, loginHash: 'new-hash' }, otherUser]);
    });

    test('changeUsersPasswordByUserId updates all three password attributes', async () => {
      const password = { loginHash: 'new-hash', passwordKeySalt: 'new-salt', userKey: 'new-key' };
      await db.changeUsersPasswordByUserId({ userId: 'missing', ...password });
      await db.changeUsersPasswordByUserId({ userId, ...password });

      expect(await db.findAllUsers()).toEqual([{ ...user, ...password }, otherUser]);
    });

    test.each([
      { role: 'admin', change: (db: InMemoryDatabaseAdapter, userId: string, admin: boolean) => db.changeUsersAdminRoleByUserId({ userId, admin }) },
      { role: 'editor', change: (db: InMemoryDatabaseAdapter, userId: string, editor: boolean) => db.changeUsersEditorRoleByUserId({ userId, editor }) },
      { role: 'moderator', change: (db: InMemoryDatabaseAdapter, userId: string, moderator: boolean) => db.changeUsersModeratorRoleByUserId({ userId, moderator }) }
    ])('changes the $role role by user ID', async ({ role, change }) => {
      await change(db, 'missing', true);
      await change(db, userId, true);
      expect(await db.findAllUsers()).toEqual([{ ...user, [role]: true }, otherUser]);

      await change(db, userId, false);
      expect(await db.findAllUsers()).toEqual([user, otherUser]);
    });

    test('findOneUserByUserId returns the matching user or null', async () => {
      expect(await db.findOneUserByUserId({ userId })).toEqual(user);
      expect(await db.findOneUserByUserId({ userId: 'missing' })).toBeNull();
    });

    test('findOneUserByUsername returns the matching user or null', async () => {
      expect(await db.findOneUserByUsername({ username })).toEqual(user);
      expect(await db.findOneUserByUsername({ username: 'missing' })).toBeNull();
    });

    test('findAllUsers returns every user', async () => {
      expect(await db.findAllUsers()).toHaveLength(2);
      expect(await db.findAllUsers()).toEqual(expect.arrayContaining([user, otherUser]));
    });

    test('deleteUserByUserId removes only the matching user and can be repeated', async () => {
      await db.deleteUserByUserId({ userId });
      await db.deleteUserByUserId({ userId });

      expect(await db.findAllUsers()).toEqual([otherUser]);
    });
  });

  describe('videos', () => {
    const { videoId } = video;

    beforeEach(async () => {
      await db.postVideo(video);
      await db.postVideo(otherVideo);
    });

    test('postVideo stores a copy of the given video', async () => {
      const input = { ...video, videoId: 'v3' };
      await db.postVideo(input);
      input.title = 'Changed outside adapter';

      expect(await db.findOneVideoByVideoId({ videoId: 'v3' })).toEqual({ ...video, videoId: 'v3' });
    });

    test.each([
      { field: 'title', changes: { title: 'New title' }, change: (db: InMemoryDatabaseAdapter, videoId: string) => db.changeVideosTitleByVideoId({ videoId, title: 'New title', ...modified }) },
      { field: 'description', changes: { description: 'New encrypted description' }, change: (db: InMemoryDatabaseAdapter, videoId: string) => db.changeVideosDescriptionByVideoId({ videoId, description: 'New encrypted description', ...modified }) },
      { field: 'metadata', changes: { meta: { duration: 30 } }, change: (db: InMemoryDatabaseAdapter, videoId: string) => db.changeVideosMetadataByVideoId({ videoId, metadata: { duration: 30 }, ...modified }) },
      { field: 'video file attributes', changes: { videoMimeType: 'video/webm' }, change: (db: InMemoryDatabaseAdapter, videoId: string) => db.changeVideosMimetypesByVideoId({ videoId, videoMimeType: 'video/webm', ...modified }) },
      { field: 'thumbnail file attributes', changes: { thumbnailMimeType: 'image/webp' }, change: (db: InMemoryDatabaseAdapter, videoId: string) => db.changeVideosMimetypesByVideoId({ videoId, thumbnailMimeType: 'image/webp', ...modified }) },
      {
        field: 'both file attributes',
        changes: { videoMimeType: 'video/webm', thumbnailMimeType: 'image/webp' },

        change: (db: InMemoryDatabaseAdapter, videoId: string) => db.changeVideosMimetypesByVideoId({ videoId, videoMimeType: 'video/webm', thumbnailMimeType: 'image/webp', ...modified })
      },
      { field: 'recorded', changes: { recorded: new Date(75) }, change: (db: InMemoryDatabaseAdapter, videoId: string) => db.changeVideosRecordedByVideoId({ videoId, recorded: new Date(75), ...modified }) }
    ])('changes the $field, lastModified and hmac for the matching video', async ({ changes, change }) => {
      await change(db, 'missing');
      await change(db, videoId);

      expect(await db.findAllVideos()).toEqual([{ ...video, ...changes, ...modified }, otherVideo]);
    });

    test('findOneVideoByVideoId returns the matching video or null', async () => {
      expect(await db.findOneVideoByVideoId({ videoId })).toEqual(video);
      expect(await db.findOneVideoByVideoId({ videoId: 'missing' })).toBeNull();
    });

    test('findManyVideosLastModified includes the boundary and excludes older videos', async () => {
      const newer = { ...video, videoId: 'v3', lastModified: new Date(300) };
      await db.postVideo(newer);
      await db.changeVideosTitleByVideoId({ videoId, title: video.title, ...modified });

      const results = await db.findManyVideosLastModified({ since: modified.lastModified });
      expect(results).toHaveLength(2);
      expect(results).toEqual(expect.arrayContaining([{ ...video, ...modified }, newer]));
      expect(await db.findManyVideosLastModified({ since: new Date(400) })).toEqual([]);
    });

    test('findAllVideos returns every video', async () => {
      expect(await db.findAllVideos()).toHaveLength(2);
      expect(await db.findAllVideos()).toEqual(expect.arrayContaining([video, otherVideo]));
    });

    test('deleteVideoByVideoId permanently clears content and preserves the first deletion timestamp', async () => {
      const lastModified = new Date(200);
      const tombstone = { ...video, deleted: true, title: '', description: '', meta: {}, videoMimeType: '', thumbnailMimeType: '', recorded: new Date(0), lastModified, hmac: '' };
      await db.deleteVideoByVideoId({ videoId, lastModified });
      expect(await db.findOneVideoByVideoId({ videoId })).toEqual(tombstone);
      expect(await db.findOneVideoByVideoId({ videoId: otherVideo.videoId })).toEqual(otherVideo);
      expect(await db.findManyVideosLastModified({ since: lastModified })).toContainEqual(tombstone);
      await db.deleteVideoByVideoId({ videoId, lastModified: new Date(300) });
      await db.deleteVideoByVideoId({ videoId: 'missing', lastModified });
      expect(await db.findOneVideoByVideoId({ videoId })).toEqual(tombstone);
      expect(await db.findAllVideos()).toHaveLength(2);
    });

    test('postVideo cannot reuse the ID of a permanently deleted video', async () => {
      await db.deleteVideoByVideoId({ videoId, lastModified: new Date(200) });
      await expect(db.postVideo(video)).rejects.toBeInstanceOf(DatabaseConflictError);
      expect(await db.findOneVideoByVideoId({ videoId })).toMatchObject({ deleted: true, hmac: '', lastModified: new Date(200) });
    });

    test('video edits cannot restore or modify a tombstone', async () => {
      await db.deleteVideoByVideoId({ videoId, lastModified: new Date(200) });
      const tombstone = await db.findOneVideoByVideoId({ videoId });
      const changes = { videoId, lastModified: new Date(300), hmac: 'changed' };
      await db.changeVideosTitleByVideoId({ ...changes, title: 'Changed' });
      await db.changeVideosDescriptionByVideoId({ ...changes, description: 'Changed' });
      await db.changeVideosMetadataByVideoId({ ...changes, metadata: { changed: true } });
      await db.changeVideosMimetypesByVideoId({ ...changes, videoMimeType: 'video/webm', thumbnailMimeType: 'image/jpeg' });
      await db.changeVideosRecordedByVideoId({ ...changes, recorded: new Date(300) });
      expect(await db.findOneVideoByVideoId({ videoId })).toEqual(tombstone);
    });
  });

  describe('comments', () => {
    const { commentId, userId, videoId } = comment;
    const forOtherVideo = { ...comment, commentId: 'c2', videoId: otherVideo.videoId };
    const byOtherUser = { ...comment, commentId: 'c3', userId: otherUser.userId };
    const changes = { ...modified, content: 'Edited comment' };

    const page = (paginationCursor = '', paginationSize = 10) => db.findManyCommentsByVideoIdSortedByCreatedDescPaginated({ videoId, paginationCursor, paginationSize });

    beforeEach(async () => {
      await db.postComment(comment);
      await db.postComment(forOtherVideo);
      await db.postComment(byOtherUser);
    });

    test('postComment stores a copy of the given comment', async () => {
      const input = { ...comment, commentId: 'c4' };
      await db.postComment(input);
      input.content = 'Changed outside adapter';

      expect(await db.findOneCommentByCommentId({ commentId: 'c4' })).toEqual({ ...comment, commentId: 'c4' });
    });

    test('changeCommentsContentByCommentIdAndUserId requires both IDs', async () => {
      await db.changeCommentsContentByCommentIdAndUserId({ commentId, userId: otherUser.userId, ...changes });
      expect((await page())[0]).toEqual([comment, byOtherUser]);

      await db.changeCommentsContentByCommentIdAndUserId({ commentId, userId, ...changes });
      expect((await page())[0]).toEqual([{ ...comment, ...changes, edited: true }, byOtherUser]);
    });

    test('changeCommentsContentByCommentId updates content and edit metadata', async () => {
      await db.changeCommentsContentByCommentId({ commentId: 'missing', ...changes });
      await db.changeCommentsContentByCommentId({ commentId, ...changes });

      expect((await page())[0]).toEqual([{ ...comment, ...changes, edited: true }, byOtherUser]);
    });

    test('markCommentAsDeletedByCommentId marks only the matching comment and clears its content', async () => {
      await db.markCommentAsDeletedByCommentId({ commentId: 'missing' });
      await db.markCommentAsDeletedByCommentId({ commentId });

      expect((await page())[0]).toEqual([{ ...comment, deleted: true, content: '' }, byOtherUser]);
    });

    test('markCommentAsDeletedByCommentIdAndUserId clears content only when both IDs match', async () => {
      await db.markCommentAsDeletedByCommentIdAndUserId({ commentId, userId: otherUser.userId });
      expect((await page())[0]).toEqual([comment, byOtherUser]);

      await db.markCommentAsDeletedByCommentIdAndUserId({ commentId, userId });
      expect((await page())[0]).toEqual([{ ...comment, deleted: true, content: '' }, byOtherUser]);
    });

    test('markCommentsAsDeletedByUserId clears content and marks all comments by that user across videos', async () => {
      await db.markCommentsAsDeletedByUserId({ userId });

      expect((await page())[0]).toEqual([{ ...comment, deleted: true, content: '' }, byOtherUser]);
      expect(await db.findOneCommentByCommentId({ commentId: forOtherVideo.commentId })).toEqual({ ...forOtherVideo, deleted: true, content: '' });
    });

    test('deleteCommentsByVideoId removes comments for just one video', async () => {
      await db.deleteCommentsByVideoId({ videoId });

      expect(await page()).toEqual([[], '']);
      expect(await db.findOneCommentByCommentId({ commentId })).toBeNull();
      expect(await db.findOneCommentByCommentId({ commentId: forOtherVideo.commentId })).toEqual(forOtherVideo);
    });

    test('findOneCommentByCommentId returns the matching comment or null', async () => {
      expect(await db.findOneCommentByCommentId({ commentId })).toEqual(comment);
      expect(await db.findOneCommentByCommentId({ commentId: 'missing' })).toBeNull();
    });

    test('paginates only the requested video, newest first with comment IDs breaking ties', async () => {
      const newest = { ...comment, commentId: 'c4', created: new Date(300) };
      await db.postComment(newest);

      const firstPage = await page('', 2);
      expect(firstPage).toEqual([[newest, comment], commentId]);

      const secondPage = await page(firstPage[1], 2);
      expect(secondPage).toEqual([[byOtherUser], '']);
    });

    test('returns an empty cursor when the last page is exactly full', async () => {
      const newest = { ...comment, commentId: 'c4', created: new Date(300) };
      const oldest = { ...comment, commentId: 'c5', created: new Date(50) };
      await db.postComment(newest);
      await db.postComment(oldest);

      const firstPage = await page('', 2);
      expect(firstPage).toEqual([[newest, comment], commentId]);
      expect(await page(firstPage[1], 2)).toEqual([[byOtherUser, oldest], '']);
    });

    test('rejects cursors that do not identify a comment of the requested video', async () => {
      expect(await page('missing')).toEqual([[], '']);
      expect(await page(forOtherVideo.commentId)).toEqual([[], '']);
    });

    test.each([0, -1, 1.5])('returns an empty page for invalid page size %s', async (size) => {
      expect(await page('', size)).toEqual([[], '']);
    });
  });

  describe('login attempts', () => {
    const { username } = user;
    const firstAttempt = new Date(100);
    const lastAttempt = new Date(200);

    test('increaseAttemptsCountByUsername creates and increments separate counters', async () => {
      await db.increaseAttemptsCountByUsername({ username, lastAttempt: firstAttempt });
      expect(await db.findOneAttemptsCountByUsername({ username })).toEqual({ username, attempts: 1, lastAttempt: firstAttempt });

      await db.increaseAttemptsCountByUsername({ username: otherUser.username, lastAttempt: firstAttempt });
      await db.increaseAttemptsCountByUsername({ username, lastAttempt });

      expect(await db.findOneAttemptsCountByUsername({ username })).toEqual({ username, attempts: 2, lastAttempt });
      expect(await db.findOneAttemptsCountByUsername({ username: otherUser.username })).toEqual({ username: otherUser.username, attempts: 1, lastAttempt: firstAttempt });
    });

    test('changeAttemptsLastAttemptByUsername restarts only the matching counter without incrementing it', async () => {
      const username = user.username;
      const first = new Date(100);
      const later = new Date(200);
      await db.increaseAttemptsCountByUsername({ username, lastAttempt: first });
      await db.increaseAttemptsCountByUsername({ username, lastAttempt: first });
      await db.increaseAttemptsCountByUsername({ username: otherUser.username, lastAttempt: first });

      await db.changeAttemptsLastAttemptByUsername({ username, lastAttempt: later });

      expect(await db.findOneAttemptsCountByUsername({ username })).toEqual({ username, attempts: 2, lastAttempt: later });
      expect(await db.findOneAttemptsCountByUsername({ username: otherUser.username })).toEqual({ username: otherUser.username, attempts: 1, lastAttempt: first });
    });

    test('changeAttemptsLastAttemptByUsername does not create an unknown counter', async () => {
      await expect(db.changeAttemptsLastAttemptByUsername({ username: 'missing-counter', lastAttempt: new Date(100) })).resolves.toBeUndefined();

      expect(await db.findOneAttemptsCountByUsername({ username: 'missing-counter' })).toBeNull();
    });

    test('clearAttemptsCountByUsername clears only the matching counter and can be repeated', async () => {
      await db.increaseAttemptsCountByUsername({ username, lastAttempt });
      await db.increaseAttemptsCountByUsername({ username: otherUser.username, lastAttempt });

      await db.clearAttemptsCountByUsername({ username });
      await db.clearAttemptsCountByUsername({ username });

      expect(await db.findOneAttemptsCountByUsername({ username })).toBeNull();
      expect(await db.findOneAttemptsCountByUsername({ username: otherUser.username })).toEqual({ username: otherUser.username, attempts: 1, lastAttempt });
    });

    test('findOneAttemptsCountByUsername returns the count for an existing username', async () => {
      await db.increaseAttemptsCountByUsername({ username: otherUser.username, lastAttempt: firstAttempt });
      await db.increaseAttemptsCountByUsername({ username, lastAttempt: firstAttempt });
      await db.increaseAttemptsCountByUsername({ username, lastAttempt });

      expect(await db.findOneAttemptsCountByUsername({ username })).toEqual({ username, attempts: 2, lastAttempt });
    });

    test('findOneAttemptsCountByUsername returns null for an unknown username', async () => {
      await db.increaseAttemptsCountByUsername({ username, lastAttempt });

      expect(await db.findOneAttemptsCountByUsername({ username: 'missing' })).toBeNull();
    });
  });
});
