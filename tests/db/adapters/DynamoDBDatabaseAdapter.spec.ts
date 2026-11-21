import { DatabaseConflictError } from '@/db/errors/DatabaseConflictError';
import { CreateTableCommand, CreateTableCommandInput, DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, QueryCommand, ScanCommand, ScanCommandOutput } from '@aws-sdk/lib-dynamodb';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import createTableInputs from '../../../dynamodb/create-tables.json';
import { DynamoDBDatabaseAdapter } from '@/db/adapters/DynamoDBDatabaseAdapter';
import { DynamoDBConf } from '@/db/config/DynamoDBConf';
import { Comment } from '@/domain/Comment';
import { User } from '@/domain/User';
import { Video } from '@/domain/Video';

describe('DynamoDBDatabaseAdapter', () => {
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

  let db: DynamoDBDatabaseAdapter;
  let config: DynamoDBConf;
  let container: StartedTestContainer | undefined;
  let transport: DynamoDBClient | undefined;
  let admin: DynamoDBDocumentClient | undefined;

  beforeAll(async () => {
    container = await new GenericContainer('amazon/dynamodb-local:3.0.0')
      .withCommand(['-jar', 'DynamoDBLocal.jar', '-inMemory', '-sharedDb'])
      .withExposedPorts(8000)
      .withWaitStrategy(Wait.forHttp('/', 8000).forStatusCodeMatching((status) => status < 500))
      .start();

    // noinspection HttpUrlsUsage (for tests and for localhost it's okay)
    config = {
      region: 'us-east-1',
      endpoint: `http://${container.getHost()}:${container.getMappedPort(8000)}`,
      accessKeyId: 'localtest',
      secretAccessKey: 'localtest'
    };
    transport = new DynamoDBClient({ region: config.region, endpoint: config.endpoint, credentials: { accessKeyId: 'localtest', secretAccessKey: 'localtest' } });
    admin = DynamoDBDocumentClient.from(transport);
    db = new DynamoDBDatabaseAdapter(config);
    await db.open();
    await db.initialize();
  });

  beforeEach(async () => {
    if (!admin) {
      return;
    }
    for (const table of createTableInputs) {
      let cursor: Record<string, unknown> | undefined = undefined;
      do {
        const page: ScanCommandOutput = await admin.send(new ScanCommand({ TableName: table.TableName, ConsistentRead: true, ExclusiveStartKey: cursor }));
        for (let start = 0; start < (page.Items?.length ?? 0); start += 25) {
          const batch = page.Items!.slice(start, start + 25);
          const result = await admin.send(
            new BatchWriteCommand({
              RequestItems: {
                [table.TableName]: batch.map((item) => ({
                  DeleteRequest: { Key: Object.fromEntries(table.KeySchema.map(({ AttributeName }) => [AttributeName, item[AttributeName]])) }
                }))
              }
            })
          );
          expect(result.UnprocessedItems?.[table.TableName] ?? []).toEqual([]);
        }
        cursor = page.LastEvaluatedKey;
      } while (cursor);
    }
  });

  afterAll(async () => {
    try {
      await db?.close();
      transport?.destroy();
    } finally {
      await container?.stop();
    }
  });

  test('open connects and can be called more than once', async () => {
    const unopened = new DynamoDBDatabaseAdapter(config);
    try {
      await expect(unopened.findAllUsers()).rejects.toThrow('DynamoDB database is not open');
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
    await expect(db.findAllUsers()).rejects.toThrow('DynamoDB database is not open');

    await db.open();
    expect(await db.findAllUsers()).toEqual([user]);
  });

  test('initialize preserves rows and accepts tables provisioned from the CLI template', async () => {
    const tablePrefix = 'precreated-';
    const isolated = new DynamoDBDatabaseAdapter({ ...config, tablePrefix });
    for (const definition of createTableInputs) {
      await transport!.send(new CreateTableCommand({ ...definition, TableName: definition.TableName.replace('video-vault-', tablePrefix) } as CreateTableCommandInput));
    }
    try {
      await isolated.open();
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
      await expect(db.createUser({ ...otherUser, userId: 'u3', username })).rejects.toMatchObject({ name: 'DatabaseConflictError', cause: { name: 'TransactionCanceledException' } });
      await expect(db.changeUsersUsernameByUserId({ userId: otherUser.userId, username })).rejects.toMatchObject({ name: 'DatabaseConflictError', cause: { name: 'TransactionCanceledException' } });

      expect(await db.findOneUserByUsername({ username })).toEqual(user);
      expect(await db.findOneUserByUserId({ userId: otherUser.userId })).toEqual(otherUser);
    });

    test('concurrent creation reserves a username for only one user', async () => {
      const username = 'concurrent';
      const results = await Promise.allSettled([db.createUser({ ...user, userId: 'u3', username }), db.createUser({ ...user, userId: 'u4', username })]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const users = (await db.findAllUsers()).filter((user) => user.username === username);
      expect(users).toHaveLength(1);
      expect(await db.findOneUserByUsername({ username })).toEqual(users[0]);
    });

    test('changeUsersPasswordByUserId updates all three password attributes', async () => {
      const password = { loginHash: 'new-hash', passwordKeySalt: 'new-salt', userKey: 'new-key' };
      await db.changeUsersPasswordByUserId({ userId: 'missing', ...password });
      await db.changeUsersPasswordByUserId({ userId, ...password });

      expect(await db.findOneUserByUserId({ userId })).toEqual({ ...user, ...password });
      expect(await db.findOneUserByUserId({ userId: otherUser.userId })).toEqual(otherUser);
    });

    test.each([
      { role: 'admin', change: (db: DynamoDBDatabaseAdapter, userId: string, admin: boolean) => db.changeUsersAdminRoleByUserId({ userId, admin }) },
      { role: 'editor', change: (db: DynamoDBDatabaseAdapter, userId: string, editor: boolean) => db.changeUsersEditorRoleByUserId({ userId, editor }) },
      { role: 'moderator', change: (db: DynamoDBDatabaseAdapter, userId: string, moderator: boolean) => db.changeUsersModeratorRoleByUserId({ userId, moderator }) }
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

    test('deleteUserByUserId removes only the matching user and releases the username', async () => {
      await db.deleteUserByUserId({ userId });
      await db.deleteUserByUserId({ userId });

      expect(await db.findAllUsers()).toEqual([otherUser]);
      expect(await db.findOneUserByUsername({ username })).toBeNull();
      const replacement = { ...user, userId: 'u3' };
      await db.createUser(replacement);
      expect(await db.findOneUserByUsername({ username })).toEqual(replacement);
    });
  });

  describe('videos', () => {
    const { videoId } = video;

    beforeEach(async () => {
      await db.postVideo(video);
      await db.postVideo(otherVideo);
    });

    test('postVideo reports duplicate IDs as a database conflict without modifying the existing record', async () => {
      await expect(db.postVideo({ ...video, title: 'Replacement' })).rejects.toBeInstanceOf(DatabaseConflictError);

      expect(await db.findOneVideoByVideoId({ videoId: video.videoId })).toEqual(video);
    });

    test('postVideo persists video metadata as JSON', async () => {
      const input = { ...video, videoId: 'v3', meta: { tracks: ['video', 'audio'], dimensions: { width: 1920 } } };
      await db.postVideo(input);

      expect(await db.findOneVideoByVideoId({ videoId: 'v3' })).toEqual(input);
    });

    test.each([
      { field: 'title', changes: { title: 'New title' }, change: (db: DynamoDBDatabaseAdapter, videoId: string) => db.changeVideosTitleByVideoId({ videoId, title: 'New title', ...modified }) },
      { field: 'metadata', changes: { meta: { duration: 30 } }, change: (db: DynamoDBDatabaseAdapter, videoId: string) => db.changeVideosMetadataByVideoId({ videoId, metadata: { duration: 30 }, ...modified }) },
      { field: 'video file attributes', changes: { videoMimeType: 'video/webm' }, change: (db: DynamoDBDatabaseAdapter, videoId: string) => db.changeVideosMimetypesByVideoId({ videoId, videoMimeType: 'video/webm', ...modified }) },
      { field: 'thumbnail file attributes', changes: { thumbnailMimeType: 'image/webp' }, change: (db: DynamoDBDatabaseAdapter, videoId: string) => db.changeVideosMimetypesByVideoId({ videoId, thumbnailMimeType: 'image/webp', ...modified }) },
      {
        field: 'both file attributes',
        changes: { videoMimeType: 'video/webm', thumbnailMimeType: 'image/webp' },
        change: (db: DynamoDBDatabaseAdapter, videoId: string) => db.changeVideosMimetypesByVideoId({ videoId, videoMimeType: 'video/webm', thumbnailMimeType: 'image/webp', ...modified })
      }
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

    test('postComment reports duplicate IDs as a database conflict without modifying the existing record', async () => {
      await expect(db.postComment({ ...comment, content: 'Replacement' })).rejects.toBeInstanceOf(DatabaseConflictError);

      expect(await db.findOneCommentByCommentId({ commentId: comment.commentId })).toEqual(comment);
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
      expect(firstPage[0]).toEqual([newest, comment]);
      expect(JSON.parse(Buffer.from(firstPage[1], 'base64url').toString())).toMatchObject({
        videoId,
        commentId,
        createdKey: expect.stringContaining(`:${commentId}`)
      });

      const secondPage = await page(firstPage[1], 2);
      expect(secondPage).toEqual([[byOtherUser], '']);
    });

    test('returns an empty cursor when the last page is exactly full', async () => {
      const newest = { ...comment, commentId: 'c4', created: new Date(300) };
      const oldest = { ...comment, commentId: 'c5', created: new Date(50) };
      await db.postComment(newest);
      await db.postComment(oldest);

      const firstPage = await page('', 2);
      expect(firstPage[0]).toEqual([newest, comment]);
      expect(JSON.parse(Buffer.from(firstPage[1], 'base64url').toString())).toMatchObject({
        videoId,
        commentId,
        createdKey: expect.stringContaining(`:${commentId}`)
      });
      expect(await page(firstPage[1], 2)).toEqual([[byOtherUser, oldest], '']);
    });

    test('rejects malformed cursors and cursors issued for a different video', async () => {
      await expect(page('invalid')).rejects.toThrow('Invalid DynamoDB comment cursor');
      const [, cursor] = await page('', 1);
      await expect(
        db.findManyCommentsByVideoIdSortedByCreatedDescPaginated({
          videoId: forOtherVideo.videoId,
          paginationCursor: cursor,
          paginationSize: 1
        })
      ).rejects.toThrow('Invalid DynamoDB comment cursor');
    });

    test('fills the requested page across DynamoDB’s 1 MB query boundary', async () => {
      const large = Array.from({ length: 7 }, (_, i) => ({
        ...comment,
        commentId: `large-${i}`,
        created: new Date(300 - i),
        content: 'x'.repeat(200_000)
      }));
      for (const item of large) {
        await db.postComment(item);
      }

      const [first, cursor] = await page('', 7);
      expect(first.map(({ commentId }) => commentId)).toEqual(large.map(({ commentId }) => commentId));
      expect(await page(cursor, 7)).toEqual([[comment, byOtherUser], '']);
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
      const second = new DynamoDBDatabaseAdapter(config);
      try {
        await second.open();
        await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? db : second).increaseAttemptsCountByUsername({ username, lastAttempt })));

        expect(await db.findOneAttemptsCountByUsername({ username })).toEqual({ username, attempts: 20, lastAttempt });
      } finally {
        await second.close();
      }
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

describe('DynamoDBDatabaseAdapter initialization permissions', () => {
  const accessDenied = Object.assign(new Error('Denied'), { name: 'AccessDeniedException' });
  const notFound = Object.assign(new Error('Not found'), { name: 'ResourceNotFoundException' });
  let adapter: DynamoDBDatabaseAdapter;
  let send: jest.SpyInstance;

  beforeEach(async () => {
    adapter = new DynamoDBDatabaseAdapter({ region: 'us-east-1' });
    await adapter.open();
    send = jest.spyOn(DynamoDBClient.prototype, 'send');
  });

  afterEach(async () => {
    send.mockRestore();
    await adapter.close();
  });

  test('requires DescribeTable permission and preserves the AWS error', async () => {
    send.mockRejectedValue(accessDenied);

    await expect(adapter.initialize()).rejects.toMatchObject({ message: expect.stringContaining('dynamodb:DescribeTable'), cause: accessDenied });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeInstanceOf(DescribeTableCommand);
  });

  test('uses the CLI table definition and reports the fallback if CreateTable is denied', async () => {
    send.mockRejectedValueOnce(notFound).mockRejectedValueOnce(accessDenied);

    await expect(adapter.initialize()).rejects.toMatchObject({ message: expect.stringContaining('dynamodb/create-tables.json'), cause: accessDenied });
    expect(send.mock.calls[1][0]).toBeInstanceOf(CreateTableCommand);
    expect(send.mock.calls[1][0].input).toEqual(createTableInputs[0]);
  });

  test('does not require CreateTable permission when matching tables already exist', async () => {
    send.mockImplementation(async (command: unknown) => {
      if (!(command instanceof DescribeTableCommand)) {
        throw accessDenied;
      }
      const definition = createTableInputs.find(({ TableName }) => TableName === command.input.TableName);
      return {
        Table: {
          ...definition,
          TableStatus: 'ACTIVE',
          GlobalSecondaryIndexes: definition?.GlobalSecondaryIndexes?.map((index) => ({ ...index, IndexStatus: 'ACTIVE' }))
        }
      };
    });

    await expect(adapter.initialize()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(createTableInputs.length);
  });

  test('rejects a manually provisioned table with the wrong key schema', async () => {
    send.mockResolvedValue({ Table: { ...createTableInputs[0], TableStatus: 'ACTIVE', KeySchema: [{ AttributeName: 'wrong', KeyType: 'HASH' }] } });

    await expect(adapter.initialize()).rejects.toThrow('does not match the adapter schema');
  });
});

describe('DynamoDBDatabaseAdapter service pagination', () => {
  let adapter: DynamoDBDatabaseAdapter;
  let send: jest.SpyInstance;

  beforeEach(async () => {
    adapter = new DynamoDBDatabaseAdapter({ region: 'us-east-1' });
    await adapter.open();
    send = jest.spyOn(DynamoDBDocumentClient.prototype, 'send');
  });

  afterEach(async () => {
    send.mockRestore();
    await adapter.close();
  });

  test('passes the encoded LastEvaluatedKey unchanged to ExclusiveStartKey', async () => {
    const key = { videoId: 'v1', commentId: 'c1', createdKey: '08639999999999900:c1' };
    const comment = { videoId: 'v1', commentId: 'c1', userId: 'u1', createdKey: key.createdKey, created: 100, lastModified: 100, content: 'content', edited: false, deleted: false, hmac: 'hmac' };
    send
      .mockResolvedValueOnce({ Items: [comment], LastEvaluatedKey: key })
      .mockResolvedValueOnce({ Items: [{ commentId: 'c2' }] })
      .mockResolvedValueOnce({ Items: [] });

    const [items, cursor] = await adapter.findManyCommentsByVideoIdSortedByCreatedDescPaginated({ videoId: 'v1', paginationCursor: '', paginationSize: 1 });
    expect(items[0].created).toEqual(new Date(100));
    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString())).toEqual(key);
    expect(await adapter.findManyCommentsByVideoIdSortedByCreatedDescPaginated({ videoId: 'v1', paginationCursor: cursor, paginationSize: 1 })).toEqual([[], '']);
    const next = send.mock.calls[2][0] as QueryCommand;
    expect(next).toBeInstanceOf(QueryCommand);
    expect(next.input.ExclusiveStartKey).toEqual(key);
    expect(next.input.IndexName).toBe('CommentsByVideo');
  });

  test('findAllUsers follows scan continuation keys', async () => {
    send.mockResolvedValueOnce({ Items: [{ userId: 'a' }], LastEvaluatedKey: { userId: 'a' } }).mockResolvedValueOnce({ Items: [{ userId: 'b' }] });

    expect(await adapter.findAllUsers()).toEqual([{ userId: 'a' }, { userId: 'b' }]);
    expect(send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ userId: 'a' });
  });
});

describe('DynamoDBDatabaseAdapter error translation', () => {
  const user: User = { userId: 'u1', username: 'alice', displayName: 'Alice', loginHash: 'hash', passwordKeySalt: 'salt', userKey: 'key', admin: false, editor: false, moderator: false };
  const video: Video = { videoId: 'v1', title: 'Video', meta: {}, lastModified: new Date(100), videoMimeType: 'video/mp4', thumbnailMimeType: 'image/png', hmac: 'hmac' };
  let db: DynamoDBDatabaseAdapter;
  let send: jest.SpyInstance;

  beforeEach(async () => {
    db = new DynamoDBDatabaseAdapter({ region: 'us-east-1' });
    await db.open();
    send = jest.spyOn(DynamoDBDocumentClient.prototype, 'send');
  });

  afterEach(async () => {
    send.mockRestore();
    await db.close();
  });

  test('translates a duplicate insert condition and retains its cause', async () => {
    const error = Object.assign(new Error('private'), { name: 'ConditionalCheckFailedException' });
    send.mockRejectedValueOnce(error);
    await expect(db.postVideo(video)).rejects.toMatchObject({ name: 'DatabaseConflictError', cause: error });
  });

  test('translates a transaction cancelled only because of failed conditions', async () => {
    const error = Object.assign(new Error('private'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }] });
    send.mockRejectedValueOnce(error);
    await expect(db.createUser(user)).rejects.toMatchObject({ name: 'DatabaseConflictError', cause: error });
  });

  test.each([
    { name: 'capacity failure', reasons: [{ Code: 'ProvisionedThroughputExceeded' }] },
    { name: 'mixed capacity and condition failure', reasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'ProvisionedThroughputExceeded' }] },
    { name: 'transaction contention', reasons: [{ Code: 'TransactionConflict' }] },
    { name: 'missing reasons', reasons: undefined },
    { name: 'empty reasons', reasons: [] },
    { name: 'malformed reasons', reasons: [{ Code: 'ConditionalCheckFailed' }, null] }
  ])('preserves $name as the original error', async ({ reasons }) => {
    const error = Object.assign(new Error('private'), { name: 'TransactionCanceledException', CancellationReasons: reasons });
    send.mockRejectedValueOnce(error);
    await expect(db.createUser(user)).rejects.toBe(error);
  });

  test('preserves unknown insert errors unchanged', async () => {
    const error = new Error('Network unavailable');
    send.mockRejectedValueOnce(error);
    await expect(db.postVideo(video)).rejects.toBe(error);
  });

  test('still treats a failed guarded update as a no-op, rather than a conflict', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('Condition failed'), { name: 'ConditionalCheckFailedException' }));
    await expect(db.changeUsersDisplayNameByUserId({ userId: 'missing', displayName: 'Name' })).resolves.toBeUndefined();
  });
});
