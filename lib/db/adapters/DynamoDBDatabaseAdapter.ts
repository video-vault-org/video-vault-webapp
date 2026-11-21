import { DatabaseConflictError } from '@/db/errors/DatabaseConflictError';
import { CreateTableCommand, CreateTableCommandInput, DescribeTableCommand, DynamoDBClient, KeySchemaElement, TableDescription, waitUntilTableExists } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  QueryCommandInput,
  QueryCommandOutput,
  ScanCommand,
  ScanCommandOutput,
  TransactWriteCommand,
  TransactWriteCommandInput,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import { DatabaseAdapter } from '@/db/adapters/DatabaseAdapter';
import { DynamoDBConf } from '@/db/config/DynamoDBConf';
import { AttemptsCount } from '@/domain/AttemptsCount';
import { Comment } from '@/domain/Comment';
import { User } from '@/domain/User';
import { Video } from '@/domain/Video';

type Key = NonNullable<QueryCommandInput['ExclusiveStartKey']>;
type Item = Key;
type Transaction = NonNullable<TransactWriteCommandInput['TransactItems']>;
type Table = 'users' | 'usernames' | 'videos' | 'comments' | 'login-attempts';
type StoredVideo = Omit<Video, 'lastModified'> & { lastModified: number; videoPartition: string };
type StoredComment = Omit<Comment, 'created' | 'lastModified'> & { created: number; lastModified: number; createdKey: string };

const byVideo = 'CommentsByVideo';
const byAuthor = 'CommentsByAuthor';
const byModified = 'VideosByLastModified';
const videoPartition = 'videos';
const dateLimit = 8_640_000_000_000_000n;

function keySchema(partition: string, sort?: string): KeySchemaElement[] {
  return sort
    ? [
        { AttributeName: partition, KeyType: 'HASH' },
        { AttributeName: sort, KeyType: 'RANGE' }
      ]
    : [{ AttributeName: partition, KeyType: 'HASH' }];
}

/**
 * Each input uses the AWS CLI CreateTable JSON shape. Ready-to-use inputs
 * for the default prefix are in dynamodb/create-tables.json. Run this with
 * the IAM profile and Region that should own the tables:
 *
 * jq -c '.[]' dynamodb/create-tables.json | while IFS= read -r input; do
 *   aws dynamodb create-table --cli-input-json "$input" || break
 * done
 *
 * For a custom tablePrefix, adjust the TableName values. The LSI must be
 * declared at table creation.
 */
function createTableInputs(prefix: string): CreateTableCommandInput[] {
  const table = (name: Table, keys: KeySchemaElement[], attributes: CreateTableCommandInput['AttributeDefinitions'], indexes: Partial<CreateTableCommandInput> = {}): CreateTableCommandInput => ({
    TableName: prefix + name,
    BillingMode: 'PAY_PER_REQUEST',
    KeySchema: keys,
    AttributeDefinitions: attributes,
    ...indexes
  });
  const string = (AttributeName: string) => ({ AttributeName, AttributeType: 'S' as const });

  return [
    table('users', keySchema('userId'), [string('userId')]),
    table('usernames', keySchema('username'), [string('username')]),
    table('login-attempts', keySchema('username'), [string('username')]),
    table('videos', keySchema('videoPartition', 'videoId'), [string('videoPartition'), string('videoId'), { AttributeName: 'lastModified', AttributeType: 'N' }], {
      LocalSecondaryIndexes: [{ IndexName: byModified, KeySchema: keySchema('videoPartition', 'lastModified'), Projection: { ProjectionType: 'ALL' } }]
    }),
    table('comments', keySchema('commentId'), ['commentId', 'videoId', 'createdKey', 'userId'].map(string), {
      GlobalSecondaryIndexes: [
        { IndexName: byVideo, KeySchema: keySchema('videoId', 'createdKey'), Projection: { ProjectionType: 'ALL' } },
        { IndexName: byAuthor, KeySchema: keySchema('userId', 'commentId'), Projection: { ProjectionType: 'KEYS_ONLY' } }
      ]
    })
  ];
}

function isError(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === name;
}

function denied(error: unknown): boolean {
  return ['AccessDeniedException', 'AccessDenied', 'UnauthorizedOperation'].some((name) => isError(error, name));
}

function verifyTable(expected: CreateTableCommandInput, actual: TableDescription): void {
  const sameKeys = (a: KeySchemaElement[] | undefined, b: KeySchemaElement[] | undefined) => a?.length === b?.length && a?.every((key) => b?.some((other) => other.KeyType === key.KeyType && other.AttributeName === key.AttributeName));
  const sameIndexes = (wanted: CreateTableCommandInput['GlobalSecondaryIndexes'], existing: TableDescription['GlobalSecondaryIndexes']) =>
    wanted?.every((index) => existing?.some((other) => index.IndexName === other.IndexName && sameKeys(index.KeySchema, other.KeySchema) && index.Projection?.ProjectionType === other.Projection?.ProjectionType)) ?? true;
  if (
    !sameKeys(expected.KeySchema, actual.KeySchema) ||
    !expected.AttributeDefinitions?.every((attribute) => actual.AttributeDefinitions?.some((other) => other.AttributeName === attribute.AttributeName && other.AttributeType === attribute.AttributeType)) ||
    !sameIndexes(expected.GlobalSecondaryIndexes, actual.GlobalSecondaryIndexes) ||
    !sameIndexes(expected.LocalSecondaryIndexes, actual.LocalSecondaryIndexes)
  ) {
    throw new Error(`DynamoDB table ${expected.TableName} does not match the adapter schema`);
  }
}

function timestamp(date: Date): number {
  const time = date.getTime();
  if (!Number.isFinite(time)) {
    throw new RangeError('Invalid DynamoDB date');
  }
  return time;
}

function decodeComment({ created, lastModified, createdKey: _createdKey, ...comment }: StoredComment): Comment {
  return { ...comment, created: new Date(created), lastModified: new Date(lastModified) };
}

function decodeVideo({ lastModified, videoPartition: _videoPartition, ...video }: StoredVideo): Video {
  return { ...video, lastModified: new Date(lastModified) };
}

function readCursor(cursor: string, videoId: string): Key {
  try {
    const key: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      /^[A-Za-z0-9_-]+$/.test(cursor) &&
      typeof key === 'object' &&
      key !== null &&
      Object.keys(key).length === 3 &&
      'videoId' in key &&
      key.videoId === videoId &&
      'commentId' in key &&
      typeof key.commentId === 'string' &&
      key.commentId.length > 0 &&
      'createdKey' in key &&
      typeof key.createdKey === 'string' &&
      /^\d{17}:/.test(key.createdKey) &&
      key.createdKey.slice(18) === key.commentId
    ) {
      return { videoId, commentId: key.commentId, createdKey: key.createdKey };
    }
  } catch {
    // Use the same error for malformed encodings and invalid keys.
  }
  throw new RangeError('Invalid DynamoDB comment cursor');
}

/**
 * IAM: initialize requires dynamodb:DescribeTable on the five configured table
 * ARNs. It attempts dynamodb:CreateTable only for missing tables (including
 * their indexes in the request). No CreateTable permission is needed when the
 * tables already match createTableInputs. A denied create reports the manual
 * provisioning fallback. The regular role needs dynamodb:GetItem, PutItem,
 * UpdateItem, DeleteItem and Scan on the tables, and dynamodb:Query on the
 * relevant index ARNs (arn:aws:dynamodb:REGION:ACCOUNT:table/TABLE/index/INDEX).
 * Transaction actions use the underlying PutItem/UpdateItem/DeleteItem grants.
 * If no credentials are configured, the AWS SDK credential chain is used.
 *
 * Comment GSIs are eventually consistent. Bulk operations act on comments
 * visible in the index at the time of enumeration. The video LSI supports
 * strongly consistent sync. Its shared partition has DynamoDB's 10 GB limit.
 */
class DynamoDBDatabaseAdapter implements DatabaseAdapter {
  private transport?: DynamoDBClient;
  private client?: DynamoDBDocumentClient;
  private readonly prefix: string;
  private readonly config: DynamoDBConf;

  public constructor(config: DynamoDBConf) {
    this.config = config;
    this.prefix = config.tablePrefix ?? 'video-vault-';
  }

  public async open(): Promise<void> {
    if (this.client) {
      return;
    }
    const { region, endpoint, accessKeyId, secretAccessKey, sessionToken } = this.config;
    if ((accessKeyId === undefined) !== (secretAccessKey === undefined) || (sessionToken !== undefined && accessKeyId === undefined)) {
      throw new Error('DynamoDB credentials require accessKeyId and secretAccessKey');
    }
    const credentials = accessKeyId !== undefined && secretAccessKey !== undefined ? { accessKeyId, secretAccessKey, sessionToken } : undefined;
    this.transport = new DynamoDBClient({ region, endpoint, credentials });
    this.client = DynamoDBDocumentClient.from(this.transport, { marshallOptions: { removeUndefinedValues: true } });
  }

  public async close(): Promise<void> {
    this.transport?.destroy();
    this.transport = undefined;
    this.client = undefined;
  }

  public async initialize(): Promise<void> {
    const transport = this.transport;
    if (!transport) {
      throw new Error('DynamoDB database is not open');
    }
    for (const input of createTableInputs(this.prefix)) {
      await this.ensureTable(transport, input);
    }
  }

  public async createUser(user: User): Promise<void> {
    await this.transact([{ Put: { TableName: this.table('users'), Item: { ...user }, ConditionExpression: 'attribute_not_exists(userId)' } }, this.reserveUsername(user.username, user.userId)]);
  }

  public async changeUsersDisplayNameByUserId({ userId, displayName }: { userId: string; displayName: string }): Promise<void> {
    await this.update('users', { userId }, { displayName });
  }

  public async changeUsersUsernameByUserId({ userId, username, loginHash }: { userId: string; username: string; loginHash: string }): Promise<void> {
    const user = await this.findOneUserByUserId({ userId });
    if (!user) {
      return;
    }
    const update = {
      Update: {
        TableName: this.table('users'),
        Key: { userId },
        UpdateExpression: 'SET username = :new, loginHash = :hash',
        ConditionExpression: 'username = :old',
        ExpressionAttributeValues: { ':new': username, ':old': user.username, ':hash': loginHash }
      }
    };
    await this.transact(username === user.username ? [update] : [this.reserveUsername(username, userId), update, this.releaseUsername(user.username, userId)]);
  }

  public async changeUsersPasswordByUserId({ userId, loginHash, passwordKeySalt, userKey }: { userId: string; loginHash: string; passwordKeySalt: string; userKey: string }): Promise<void> {
    await this.update('users', { userId }, { loginHash, passwordKeySalt, userKey });
  }

  public async changeUsersAdminRoleByUserId({ userId, admin }: { userId: string; admin: boolean }): Promise<void> {
    await this.update('users', { userId }, { admin });
  }

  public async changeUsersEditorRoleByUserId({ userId, editor }: { userId: string; editor: boolean }): Promise<void> {
    await this.update('users', { userId }, { editor });
  }

  public async changeUsersModeratorRoleByUserId({ userId, moderator }: { userId: string; moderator: boolean }): Promise<void> {
    await this.update('users', { userId }, { moderator });
  }

  public async findOneUserByUserId({ userId }: { userId: string }): Promise<User | null> {
    return this.get<User>('users', { userId });
  }

  public async findOneUserByUsername({ username }: { username: string }): Promise<User | null> {
    const reservation = await this.get<{ userId: string }>('usernames', { username });
    if (!reservation) {
      return null;
    }
    const user = await this.findOneUserByUserId(reservation);
    return user?.username === username ? user : null;
  }

  public async findAllUsers(): Promise<User[]> {
    return this.scan<User>('users');
  }

  public async deleteUserByUserId({ userId }: { userId: string }): Promise<void> {
    const user = await this.findOneUserByUserId({ userId });
    if (!user) {
      return;
    }
    await this.transact([
      {
        Delete: {
          TableName: this.table('users'),
          Key: { userId },
          ConditionExpression: 'username = :old',
          ExpressionAttributeValues: { ':old': user.username }
        }
      },
      this.releaseUsername(user.username, userId)
    ]);
  }

  public async postVideo(video: Video): Promise<void> {
    await this.insert('videos', 'videoId', { ...video, videoPartition, lastModified: timestamp(video.lastModified) });
  }

  public async changeVideosTitleByVideoId({ videoId, title, lastModified, hmac }: { videoId: string; title: string; lastModified: Date; hmac: string }): Promise<void> {
    await this.update('videos', { videoPartition, videoId }, { title, lastModified: timestamp(lastModified), hmac });
  }

  public async changeVideosMetadataByVideoId({ videoId, metadata, lastModified, hmac }: { videoId: string; metadata: Record<string, unknown>; lastModified: Date; hmac: string }): Promise<void> {
    await this.update('videos', { videoPartition, videoId }, { meta: metadata, lastModified: timestamp(lastModified), hmac });
  }

  public async changeVideosMimetypesByVideoId({ videoId, videoMimeType, thumbnailMimeType, lastModified, hmac }: { videoId: string; videoMimeType?: string; thumbnailMimeType?: string; lastModified: Date; hmac: string }): Promise<void> {
    await this.update('videos', { videoPartition, videoId }, { lastModified: timestamp(lastModified), hmac, ...(videoMimeType !== undefined ? { videoMimeType } : {}), ...(thumbnailMimeType !== undefined ? { thumbnailMimeType } : {}) });
  }

  public async findOneVideoByVideoId({ videoId }: { videoId: string }): Promise<Video | null> {
    const video = await this.get<StoredVideo>('videos', { videoPartition, videoId });
    return video ? decodeVideo(video) : null;
  }

  public async findManyVideosLastModified({ since }: { since: Date }): Promise<Video[]> {
    const query: QueryCommandInput = {
      TableName: this.table('videos'),
      IndexName: byModified,
      ConsistentRead: true,
      KeyConditionExpression: 'videoPartition = :partition AND lastModified >= :since',
      ExpressionAttributeValues: { ':partition': videoPartition, ':since': timestamp(since) }
    };
    const videos: Video[] = [];
    for await (const page of this.queryPages(query)) {
      for (const item of page) {
        videos.push(decodeVideo(item as StoredVideo));
      }
    }
    return videos;
  }

  public async findAllVideos(): Promise<Video[]> {
    return (await this.scan<StoredVideo>('videos')).map(decodeVideo);
  }

  public async deleteVideoByVideoId({ videoId }: { videoId: string }): Promise<void> {
    await this.documentClient().send(new DeleteCommand({ TableName: this.table('videos'), Key: { videoPartition, videoId } }));
  }

  public async postComment(comment: Comment): Promise<void> {
    const created = timestamp(comment.created);
    // Invert the timestamp for newest-first scans, preserving ascending IDs for ties.
    const createdKey = `${(dateLimit - BigInt(created)).toString().padStart(17, '0')}:${comment.commentId}`;
    await this.insert('comments', 'commentId', { ...comment, created, createdKey, lastModified: timestamp(comment.lastModified) });
  }

  public async changeCommentsContentByCommentIdAndUserId({ commentId, userId, content, lastModified, hmac }: { commentId: string; userId: string; content: string; lastModified: Date; hmac: string }): Promise<void> {
    await this.update('comments', { commentId }, { content, lastModified: timestamp(lastModified), hmac, edited: true }, { field: 'userId', value: userId });
  }

  public async changeCommentsContentByCommentId({ commentId, content, lastModified, hmac }: { commentId: string; content: string; lastModified: Date; hmac: string }): Promise<void> {
    await this.update('comments', { commentId }, { content, lastModified: timestamp(lastModified), hmac, edited: true });
  }

  public async markCommentAsDeletedByCommentId({ commentId }: { commentId: string }): Promise<void> {
    await this.update('comments', { commentId }, { deleted: true, content: '' });
  }

  public async markCommentAsDeletedByCommentIdAndUserId({ commentId, userId }: { commentId: string; userId: string }): Promise<void> {
    await this.update('comments', { commentId }, { deleted: true, content: '' }, { field: 'userId', value: userId });
  }

  public async markCommentsAsDeletedByUserId({ userId }: { userId: string }): Promise<void> {
    const query = this.commentsQuery(byAuthor, 'userId', userId, true);
    for await (const page of this.queryPages(query)) {
      await this.forEachCommentId(page, (commentId) => this.markCommentAsDeletedByCommentIdAndUserId({ commentId, userId }));
    }
  }

  public async deleteCommentsByVideoId({ videoId }: { videoId: string }): Promise<void> {
    const query = this.commentsQuery(byVideo, 'videoId', videoId, true);
    for await (const page of this.queryPages(query)) {
      await this.forEachCommentId(page, (commentId) =>
        this.whenMatching(() =>
          this.documentClient().send(
            new DeleteCommand({
              TableName: query.TableName,
              Key: { commentId },
              ConditionExpression: 'videoId = :videoId',
              ExpressionAttributeValues: { ':videoId': videoId }
            })
          )
        )
      );
    }
  }

  public async findManyCommentsByVideoIdSortedByCreatedDescPaginated({ videoId, paginationCursor, paginationSize }: { videoId: string; paginationCursor: string; paginationSize: number }): Promise<[Comment[], string]> {
    if (!Number.isSafeInteger(paginationSize) || paginationSize <= 0) {
      return [[], ''];
    }
    const query = this.commentsQuery(byVideo, 'videoId', videoId);
    let cursor = paginationCursor ? readCursor(paginationCursor, videoId) : undefined;
    const comments: Comment[] = [];
    do {
      const { Items = [], LastEvaluatedKey } = await this.documentClient().send(
        new QueryCommand({
          ...query,
          ExclusiveStartKey: cursor,
          Limit: Math.min(paginationSize - comments.length, 2_147_483_647)
        })
      );
      for (const item of Items) {
        comments.push(decodeComment(item as StoredComment));
      }
      cursor = LastEvaluatedKey;
    } while (cursor && comments.length < paginationSize);

    // A LastEvaluatedKey on a page boundary does not guarantee another match.
    if (cursor && comments.length) {
      const probe = this.commentsQuery(byVideo, 'videoId', videoId, true);
      const { Items } = await this.documentClient().send(new QueryCommand({ ...probe, ExclusiveStartKey: cursor, Limit: 1 }));
      if (Items?.length) {
        return [comments, Buffer.from(JSON.stringify(cursor)).toString('base64url')];
      }
    }
    return [comments, ''];
  }

  public async findOneCommentByCommentId({ commentId }: { commentId: string }): Promise<Comment | null> {
    const comment = await this.get<StoredComment>('comments', { commentId });
    return comment ? decodeComment(comment) : null;
  }

  public async increaseAttemptsCountByUsername({ username, lastAttempt }: { username: string; lastAttempt: Date }): Promise<void> {
    await this.documentClient().send(
      new UpdateCommand({
        TableName: this.table('login-attempts'),
        Key: { username },
        UpdateExpression: 'SET lastAttempt = :time ADD attempts :one',
        ExpressionAttributeValues: { ':time': timestamp(lastAttempt), ':one': 1 }
      })
    );
  }

  public async changeAttemptsLastAttemptByUsername({ username, lastAttempt }: { username: string; lastAttempt: Date }): Promise<void> {
    await this.whenMatching(() =>
      this.documentClient().send(
        new UpdateCommand({
          TableName: this.table('login-attempts'),
          Key: { username },
          UpdateExpression: 'SET lastAttempt = :time',
          ConditionExpression: 'attribute_exists(username)',
          ExpressionAttributeValues: { ':time': timestamp(lastAttempt) }
        })
      )
    );
  }

  public async clearAttemptsCountByUsername({ username }: { username: string }): Promise<void> {
    await this.documentClient().send(new DeleteCommand({ TableName: this.table('login-attempts'), Key: { username } }));
  }

  public async findOneAttemptsCountByUsername({ username }: { username: string }): Promise<AttemptsCount | null> {
    const count = await this.get<Omit<AttemptsCount, 'lastAttempt'> & { lastAttempt: number }>('login-attempts', { username });
    return count ? { ...count, lastAttempt: new Date(count.lastAttempt) } : null;
  }

  private documentClient(): DynamoDBDocumentClient {
    if (!this.client) {
      throw new Error('DynamoDB database is not open');
    }
    return this.client;
  }

  private table(name: Table): string {
    return this.prefix + name;
  }

  private async ensureTable(client: DynamoDBClient, input: CreateTableCommandInput): Promise<void> {
    const TableName = input.TableName!;
    const describe = async () => {
      try {
        return (await client.send(new DescribeTableCommand({ TableName }))).Table;
      } catch (error) {
        if (isError(error, 'ResourceNotFoundException')) {
          return undefined;
        }
        if (denied(error)) {
          throw Object.assign(new Error(`DynamoDB initialize requires dynamodb:DescribeTable for ${TableName}`), { cause: error });
        }
        throw error;
      }
    };
    let actual = await describe();
    if (!actual) {
      try {
        await client.send(new CreateTableCommand(input));
      } catch (error) {
        if (!isError(error, 'ResourceInUseException')) {
          if (denied(error)) {
            throw Object.assign(new Error(`Missing DynamoDB table ${TableName}: grant dynamodb:CreateTable or use dynamodb/create-tables.json to create it manually`), { cause: error });
          }
          throw error;
        }
      }
    }
    if (actual?.TableStatus !== 'ACTIVE') {
      await waitUntilTableExists({ client, maxWaitTime: 120, minDelay: 1, maxDelay: 5 }, { TableName });
      actual = await describe();
    }
    if (!actual) {
      throw new Error(`DynamoDB table ${TableName} is unavailable`);
    }
    verifyTable(input, actual);
    if (actual.GlobalSecondaryIndexes?.some((index) => input.GlobalSecondaryIndexes?.some((expected) => expected.IndexName === index.IndexName) && index.IndexStatus !== 'ACTIVE')) {
      throw new Error(`DynamoDB indexes for ${TableName} are not active yet`);
    }
  }

  private async get<T>(table: Table, Key: Key): Promise<T | null> {
    const { Item } = await this.documentClient().send(new GetCommand({ TableName: this.table(table), Key, ConsistentRead: true }));
    return (Item as T | undefined) ?? null;
  }

  private async scan<T>(table: Table): Promise<T[]> {
    const items: T[] = [];
    let cursor: Key | undefined = undefined;
    do {
      const page: ScanCommandOutput = await this.documentClient().send(new ScanCommand({ TableName: this.table(table), ExclusiveStartKey: cursor }));
      for (const item of page.Items ?? []) {
        items.push(item as T);
      }
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    return items;
  }

  private async insert(table: Table, field: string, Item: Item): Promise<void> {
    try {
      await this.documentClient().send(
        new PutCommand({
          TableName: this.table(table),
          Item,
          ConditionExpression: 'attribute_not_exists(#key)',
          ExpressionAttributeNames: { '#key': field }
        })
      );
    } catch (error) {
      if (isError(error, 'ConditionalCheckFailedException')) {
        throw new DatabaseConflictError(undefined, { cause: error });
      }
      throw error;
    }
  }

  private async update(table: Table, Key: Key, changes: Item, guard?: { field: string; value: string }): Promise<void> {
    const names: Record<string, string> = { '#key': Object.keys(Key)[0] };
    const values: Item = {};
    const assignments = Object.entries(changes).map(([field, value], index) => {
      names[`#field${index}`] = field;
      values[`:value${index}`] = value;
      return `#field${index} = :value${index}`;
    });
    let condition = 'attribute_exists(#key)';
    if (guard) {
      condition += ' AND #guard = :guard';
      names['#guard'] = guard.field;
      values[':guard'] = guard.value;
    }
    await this.whenMatching(() =>
      this.documentClient().send(
        new UpdateCommand({
          TableName: this.table(table),
          Key,
          UpdateExpression: `SET ${assignments.join(', ')}`,
          ConditionExpression: condition,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values
        })
      )
    );
  }

  private async whenMatching(write: () => Promise<unknown>): Promise<void> {
    try {
      await write();
    } catch (error) {
      if (!isError(error, 'ConditionalCheckFailedException')) {
        throw error;
      }
    }
  }

  private async transact(TransactItems: Transaction): Promise<void> {
    try {
      await this.documentClient().send(new TransactWriteCommand({ TransactItems }));
    } catch (error) {
      const reasons = (error as { CancellationReasons?: { Code?: string }[] } | null)?.CancellationReasons;
      if (
        isError(error, 'TransactionCanceledException') &&
        Array.isArray(reasons) &&
        reasons.some((reason) => reason?.Code === 'ConditionalCheckFailed') &&
        reasons.every((reason) => reason?.Code === 'None' || reason?.Code === 'ConditionalCheckFailed')
      ) {
        throw new DatabaseConflictError(undefined, { cause: error });
      }
      throw error;
    }
  }

  private reserveUsername(username: string, userId: string): Transaction[number] {
    return { Put: { TableName: this.table('usernames'), Item: { username, userId }, ConditionExpression: 'attribute_not_exists(username)' } };
  }

  private releaseUsername(username: string, userId: string): Transaction[number] {
    return { Delete: { TableName: this.table('usernames'), Key: { username }, ConditionExpression: 'userId = :user', ExpressionAttributeValues: { ':user': userId } } };
  }

  private commentsQuery(index: string, field: 'videoId' | 'userId', value: string, keysOnly = false): QueryCommandInput {
    return {
      TableName: this.table('comments'),
      IndexName: index,
      ScanIndexForward: true,
      KeyConditionExpression: `${field} = :value`,
      ExpressionAttributeValues: { ':value': value },
      ProjectionExpression: keysOnly ? 'commentId' : undefined
    };
  }

  private async *queryPages(input: QueryCommandInput): AsyncGenerator<Item[]> {
    let cursor: Key | undefined = undefined;
    do {
      const page: QueryCommandOutput = await this.documentClient().send(new QueryCommand({ ...input, ExclusiveStartKey: cursor }));
      yield page.Items ?? [];
      cursor = page.LastEvaluatedKey;
    } while (cursor);
  }

  private async forEachCommentId(items: Item[], apply: (commentId: string) => Promise<void>): Promise<void> {
    for (let start = 0; start < items.length; start += 10) {
      await Promise.all(items.slice(start, start + 10).map((item) => apply(item.commentId as string)));
    }
  }
}

export { DynamoDBDatabaseAdapter };
