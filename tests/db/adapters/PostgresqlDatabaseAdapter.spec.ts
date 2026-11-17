import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { PostgresqlDatabaseAdapter } from '@/db/adapters/PostgresqlDatabaseAdapter';
import { PostgresqlDatabaseConf } from '@/db/config/PostgresqlDatabaseConf';
import { Comment } from '@/domain/Comment';
import { User } from '@/domain/User';
import { Video } from '@/domain/Video';

describe('PostgresqlDatabaseAdapter', () => {
  jest.setTimeout(120_000);
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
    videoId: 'v1',
    title: 'Original',
    meta: { duration: 10 },
    videoMimeType: 'video/mp4',
    thumbnailMimeType: 'image/png',
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

  let db: PostgresqlDatabaseAdapter;
  let config: PostgresqlDatabaseConf;
  let container: StartedPostgreSqlContainer | undefined;
  let admin: Pool | undefined;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18.1').withDatabase('video-vault-test').withUsername('vault-test').withPassword('vault-test-password').start();
    config = {
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword()
    };
    admin = new Pool({ ...config, connectionTimeoutMillis: 5000 });
    const setup = new PostgresqlDatabaseAdapter(config);
    try {
      await setup.open();
      await setup.initialize();
    } finally {
      await setup.close();
    }
  });

  beforeEach(async () => {
    if (!admin) {
      return;
    }
    await admin.query('TRUNCATE users, videos, comments, login_attempts');
    db = new PostgresqlDatabaseAdapter(config);
    await db.open();
  });

  afterEach(async () => {
    await db?.close();
  });

  afterAll(async () => {
    await admin?.end();
    await container?.stop();
  });

  test('open connects and can be called more than once', async () => {
    const unopened = new PostgresqlDatabaseAdapter(config);
    try {
      await expect(unopened.findAllUsers()).rejects.toThrow('PostgreSQL database is not open');
      await Promise.all([unopened.open(), unopened.open()]);
      expect(await unopened.findAllUsers()).toEqual([]);
    } finally {
      await unopened.close();
    }
  });

  test('close releases the connection and allows reopening', async () => {
    await db.createUser(user);

    await db.close();
    await db.close();
    await expect(db.findAllUsers()).rejects.toThrow('PostgreSQL database is not open');

    await db.open();
    expect(await db.findAllUsers()).toEqual([user]);
  });

  test('initialize creates the schema in the default database and preserves data when called again', async () => {
    const isolated = new PostgresqlDatabaseAdapter({ ...config, database: undefined });
    await admin!.query('CREATE DATABASE "video-vault-db"');
    try {
      await isolated.open();
      await expect(isolated.findAllUsers()).rejects.toMatchObject({ code: '42P01' });
      await isolated.initialize();
      await isolated.createUser(user);
      await isolated.postVideo(video);
      await isolated.postComment(comment);
      await isolated.increaseAttemptsCountByUsername({ username: user.username, lastAttempt: new Date(100) });
      await isolated.initialize();

      expect(await isolated.findAllUsers()).toEqual([user]);
      expect(await isolated.findAllVideos()).toEqual([video]);
      expect(await isolated.findOneCommentByCommentId({ commentId: comment.commentId })).toEqual(comment);
      expect(await isolated.findOneAttemptsCountByUsername({ username: user.username })).toEqual({ username: user.username, attempts: 1, lastAttempt: new Date(100) });
      expect(await db.findAllUsers()).toEqual([]);
    } finally {
      await isolated.close();
      await admin!.query('DROP DATABASE "video-vault-db"');
    }
  });

  describe('users', () => {
    const { userId, username } = user;

    beforeEach(async () => {
      await db.createUser(user);
      await db.createUser(otherUser);
    });

    test('createUser stores the supplied user', async () => {
      const input = { ...user, userId: 'u3', username: 'charlie' };
      await db.createUser(input);

      expect(await db.findOneUserByUserId({ userId: input.userId })).toEqual({ ...user, userId: 'u3', username: 'charlie' });
    });

    test('changeUsersDisplayNameByUserId updates only the matching user', async () => {
      await db.changeUsersDisplayNameByUserId({ userId: 'missing', displayName: 'Ignored' });
      await db.changeUsersDisplayNameByUserId({ userId, displayName: 'New display name' });

      expect(await db.findOneUserByUserId({ userId })).toEqual({ ...user, displayName: 'New display name' });
      expect(await db.findOneUserByUserId({ userId: otherUser.userId })).toEqual(otherUser);
    });

    test('changeUsersUsernameByUserId makes the user findable under the new username', async () => {
      await db.changeUsersUsernameByUserId({ userId: 'missing', username: 'ignored' });
      await db.changeUsersUsernameByUserId({ userId, username: 'new-name' });

      expect(await db.findOneUserByUsername({ username })).toBeNull();
      expect(await db.findOneUserByUsername({ username: 'new-name' })).toEqual({ ...user, username: 'new-name' });
      expect(await db.findOneUserByUserId({ userId: otherUser.userId })).toEqual(otherUser);
    });

    test('duplicate usernames are rejected without changing the existing user', async () => {
      await expect(db.createUser({ ...otherUser, userId: 'u3', username })).rejects.toMatchObject({ code: '23505' });
      await expect(db.changeUsersUsernameByUserId({ userId: otherUser.userId, username })).rejects.toMatchObject({ code: '23505' });

      expect(await db.findOneUserByUsername({ username })).toEqual(user);
      expect(await db.findOneUserByUserId({ userId: otherUser.userId })).toEqual(otherUser);
    });

    test('changeUsersPasswordByUserId updates all three password attributes', async () => {
      const password = { loginHash: 'new-hash', passwordKeySalt: 'new-salt', userKey: 'new-key' };
      await db.changeUsersPasswordByUserId({ userId: 'missing', ...password });
      await db.changeUsersPasswordByUserId({ userId, ...password });

      expect(await db.findOneUserByUserId({ userId })).toEqual({ ...user, ...password });
      expect(await db.findOneUserByUserId({ userId: otherUser.userId })).toEqual(otherUser);
    });

    test.each([
      { role: 'admin', change: (db: PostgresqlDatabaseAdapter, userId: string, admin: boolean) => db.changeUsersAdminRoleByUserId({ userId, admin }) },
      { role: 'editor', change: (db: PostgresqlDatabaseAdapter, userId: string, editor: boolean) => db.changeUsersEditorRoleByUserId({ userId, editor }) },
      { role: 'moderator', change: (db: PostgresqlDatabaseAdapter, userId: string, moderator: boolean) => db.changeUsersModeratorRoleByUserId({ userId, moderator }) }
    ])('changes the $role role by user ID', async ({ role, change }) => {
      await change(db, 'missing', true);
      await change(db, userId, true);
      expect(await db.findOneUserByUserId({ userId })).toEqual({ ...user, [role]: true });

      await change(db, userId, false);
      expect(await db.findOneUserByUserId({ userId })).toEqual(user);
      expect(await db.findOneUserByUserId({ userId: otherUser.userId })).toEqual(otherUser);
    });

    test('findOneUserByUserId returns the matching user or null', async () => {
      expect(await db.findOneUserByUserId({ userId })).toEqual(user);
      expect(await db.findOneUserByUserId({ userId: 'missing' })).toBeNull();
    });

    test('handles apostrophes in query values', async () => {
      const username = "O'Neil";
      await db.changeUsersUsernameByUserId({ userId, username });

      expect(await db.findOneUserByUsername({ username })).toEqual({ ...user, username });
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

    test('postVideo persists video metadata as JSON', async () => {
      const input = { ...video, videoId: 'v3', meta: { tracks: ['video', 'audio'], dimensions: { width: 1920 } } };
      await db.postVideo(input);

      expect(await db.findOneVideoByVideoId({ videoId: 'v3' })).toEqual(input);
    });

    test.each([
      { field: 'title', changes: { title: 'New title' }, change: (db: PostgresqlDatabaseAdapter, videoId: string) => db.changeVideosTitleByVideoId({ videoId, title: 'New title', ...modified }) },
      { field: 'metadata', changes: { meta: { duration: 30 } }, change: (db: PostgresqlDatabaseAdapter, videoId: string) => db.changeVideosMetadataByVideoId({ videoId, metadata: { duration: 30 }, ...modified }) },
      { field: 'video MIME type', changes: { videoMimeType: 'video/webm' }, change: (db: PostgresqlDatabaseAdapter, videoId: string) => db.changeVideosVideoMimetypeByVideoId({ videoId, mimetype: 'video/webm', ...modified }) },
      { field: 'thumbnail MIME type', changes: { thumbnailMimeType: 'image/webp' }, change: (db: PostgresqlDatabaseAdapter, videoId: string) => db.changeVideosThumbnailMimetypeByVideoId({ videoId, mimetype: 'image/webp', ...modified }) }
    ])('changes the $field, lastModified and hmac for the matching video', async ({ changes, change }) => {
      await change(db, 'missing');
      await change(db, videoId);

      expect(await db.findOneVideoByVideoId({ videoId })).toEqual({ ...video, ...changes, ...modified });
      expect(await db.findOneVideoByVideoId({ videoId: otherVideo.videoId })).toEqual(otherVideo);
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

    test('deleteVideoByVideoId removes only the matching video and can be repeated', async () => {
      await db.deleteVideoByVideoId({ videoId });
      await db.deleteVideoByVideoId({ videoId });

      expect(await db.findAllVideos()).toEqual([otherVideo]);
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

    test('postComment persists the supplied comment', async () => {
      const input = { ...comment, commentId: 'c4' };
      await db.postComment(input);

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

    test('markCommentAsDeletedByCommentId marks only the matching comment', async () => {
      await db.markCommentAsDeletedByCommentId({ commentId: 'missing' });
      await db.markCommentAsDeletedByCommentId({ commentId });

      expect((await page())[0]).toEqual([{ ...comment, deleted: true }, byOtherUser]);
    });

    test('markCommentAsDeletedByCommentIdAndUserId requires both IDs', async () => {
      await db.markCommentAsDeletedByCommentIdAndUserId({ commentId, userId: otherUser.userId });
      expect((await page())[0]).toEqual([comment, byOtherUser]);

      await db.markCommentAsDeletedByCommentIdAndUserId({ commentId, userId });
      expect((await page())[0]).toEqual([{ ...comment, deleted: true }, byOtherUser]);
    });

    test('markCommentsAsDeletedByUserId marks all comments by that user across videos', async () => {
      await db.markCommentsAsDeletedByUserId({ userId });

      expect((await page())[0]).toEqual([{ ...comment, deleted: true }, byOtherUser]);
      expect(await db.findOneCommentByCommentId({ commentId: forOtherVideo.commentId })).toEqual({ ...forOtherVideo, deleted: true });
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
      expect(secondPage).toEqual([[byOtherUser], byOtherUser.commentId]);
      expect(await page(secondPage[1], 2)).toEqual([[], '']);
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

    test('concurrent increments on independent connections do not lose attempts', async () => {
      const second = new PostgresqlDatabaseAdapter(config);
      try {
        await second.open();
        await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? db : second).increaseAttemptsCountByUsername({ username, lastAttempt })));

        expect(await db.findOneAttemptsCountByUsername({ username })).toEqual({ username, attempts: 20, lastAttempt });
      } finally {
        await second.close();
      }
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
