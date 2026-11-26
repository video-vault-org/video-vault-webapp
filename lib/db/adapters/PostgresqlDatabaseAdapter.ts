import { Session } from '@/domain/Session';
import { DatabaseConflictError } from '@/db/errors/DatabaseConflictError';
import { Pool, PoolConfig, QueryResultRow } from 'pg';
import { DatabaseAdapter } from '@/db/adapters/DatabaseAdapter';
import { AttemptsCount } from '@/domain/AttemptsCount';
import { Comment } from '@/domain/Comment';
import { User } from '@/domain/User';
import { UserDisplayName } from '@/domain/UserDisplayName';
import { Video } from '@/domain/Video';
import { PostgresqlDatabaseConf } from '@/db/config/PostgresqlDatabaseConf';

const schema = `
  CREATE TABLE IF NOT EXISTS sessions (
    "sessionId" text PRIMARY KEY, "userId" text NOT NULL, version text NOT NULL, "expiresAt" bigint NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions ("expiresAt");
  CREATE TABLE IF NOT EXISTS session_versions (
    "userId" text PRIMARY KEY, version text NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    "userId" text PRIMARY KEY,
    username text NOT NULL UNIQUE,
    "displayName" text NOT NULL,
    "loginHash" text NOT NULL,
    "passwordKeySalt" text NOT NULL,
    "userKey" text NOT NULL,
    admin boolean NOT NULL,
    editor boolean NOT NULL,
    moderator boolean NOT NULL
  );

  CREATE TABLE IF NOT EXISTS videos (
    "videoId" text PRIMARY KEY,
    title text NOT NULL,
    description text NOT NULL,
    meta jsonb NOT NULL,
    "videoMimeType" text NOT NULL,
    "thumbnailMimeType" text NOT NULL,
    recorded timestamptz NOT NULL,
    "lastModified" timestamptz NOT NULL,
    hmac text NOT NULL,
    deleted boolean NOT NULL
  );

  CREATE TABLE IF NOT EXISTS comments (
    "commentId" text COLLATE "C" PRIMARY KEY,
    "userId" text NOT NULL,
    "videoId" text NOT NULL,
    content text NOT NULL,
    created timestamptz NOT NULL,
    "lastModified" timestamptz NOT NULL,
    edited boolean NOT NULL,
    deleted boolean NOT NULL,
    hmac text NOT NULL
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    username text PRIMARY KEY,
    attempts integer NOT NULL,
    "lastAttempt" timestamptz NOT NULL
  );

  CREATE INDEX IF NOT EXISTS videos_last_modified_idx ON videos ("lastModified");
  CREATE INDEX IF NOT EXISTS comments_video_created_idx ON comments ("videoId", created DESC, "commentId");
  CREATE INDEX IF NOT EXISTS comments_user_idx ON comments ("userId");
`;

class PostgresqlDatabaseAdapter implements DatabaseAdapter {
  private connection?: Promise<Pool>;
  private readonly config: PoolConfig;

  public constructor(conf: PostgresqlDatabaseConf) {
    this.config = {
      ...conf,
      database: conf.database ?? 'video-vault-db',
      max: 5,
      min: 0,
      idleTimeoutMillis: 30_000,
      allowExitOnIdle: false
    };
  }

  public async open(): Promise<void> {
    this.connection ??= this.connect();
    const connection = this.connection;
    try {
      await connection;
    } catch (error) {
      if (this.connection === connection) {
        this.connection = undefined;
      }
      throw error;
    }
  }

  public async close(): Promise<void> {
    const connection = this.connection;
    if (!connection) {
      return;
    }
    this.connection = undefined;
    const pool = await connection.catch(() => undefined);
    await pool?.end();
  }

  public async initialize(): Promise<void> {
    const client = await (await this.pool()).connect();
    try {
      await client.query('BEGIN');
      // Serialize schema creation when several instances start together.
      await client.query('SELECT pg_advisory_xact_lock(1180075108, 1)');
      await client.query(schema);
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        client.release(true);
        this.rethrow(error);
      }
      client.release();
      this.rethrow(error);
    }
    client.release();
  }

  public async createSession({ sessionId, userId, version, expiresAt }: Session): Promise<void> {
    await this.query('DELETE FROM sessions WHERE "expiresAt" <= $1', [Date.now()]);
    await this.query('INSERT INTO sessions ("sessionId", "userId", version, "expiresAt") VALUES ($1, $2, $3, $4)', [sessionId, userId, version, expiresAt]);
  }

  public async findSessionById({ sessionId }: { sessionId: string }): Promise<Session | null> {
    const session = (await this.query<Session>('SELECT * FROM sessions WHERE "sessionId" = $1', [sessionId]))[0] ?? null;
    return session ? { ...session, expiresAt: Number(session.expiresAt) } : null;
  }

  public async deleteSessionById({ sessionId }: { sessionId: string }): Promise<void> {
    await this.query('DELETE FROM sessions WHERE "sessionId" = $1', [sessionId]);
  }

  public async findSessionVersionByUserId({ userId }: { userId: string }): Promise<string> {
    return (await this.query<{ version: string }>('SELECT version FROM session_versions WHERE "userId" = $1', [userId]))[0]?.version ?? '';
  }

  public async changeSessionVersionByUserId({ userId, version }: { userId: string; version: string }): Promise<void> {
    await this.query('INSERT INTO session_versions ("userId", version) VALUES ($1, $2) ON CONFLICT ("userId") DO UPDATE SET version = excluded.version', [userId, version]);
  }

  public async createUser({ userId, username, displayName, loginHash, passwordKeySalt, userKey, admin, editor, moderator }: User): Promise<void> {
    await this.query('INSERT INTO users ("userId", username, "displayName", "loginHash", "passwordKeySalt", "userKey", admin, editor, moderator) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
      userId,
      username,
      displayName,
      loginHash,
      passwordKeySalt,
      userKey,
      admin,
      editor,
      moderator
    ]);
  }

  public async changeUsersDisplayNameByUserId({ userId, displayName }: { userId: string; displayName: string }): Promise<void> {
    await this.query('UPDATE users SET "displayName" = $2 WHERE "userId" = $1', [userId, displayName]);
  }

  public async changeUsersUsernameByUserId({ userId, username, loginHash }: { userId: string; username: string; loginHash: string }): Promise<void> {
    await this.query('UPDATE users SET username = $2, "loginHash" = $3 WHERE "userId" = $1', [userId, username, loginHash]);
  }

  public async changeUsersPasswordByUserId({ userId, loginHash, passwordKeySalt, userKey }: { userId: string; loginHash: string; passwordKeySalt: string; userKey: string }): Promise<void> {
    await this.query('UPDATE users SET "loginHash" = $2, "passwordKeySalt" = $3, "userKey" = $4 WHERE "userId" = $1', [userId, loginHash, passwordKeySalt, userKey]);
  }

  public async initializeUsersKeysByUserId({ userId, passwordKeySalt, userKey }: { userId: string; passwordKeySalt: string; userKey: string }): Promise<boolean> {
    return (await this.query(`UPDATE users SET "passwordKeySalt" = $2, "userKey" = $3 WHERE "userId" = $1 AND admin = TRUE AND "userKey" = '' RETURNING "userId"`, [userId, passwordKeySalt, userKey])).length === 1;
  }

  public async changeUsersAdminRoleByUserId({ userId, admin }: { userId: string; admin: boolean }): Promise<void> {
    await this.query('UPDATE users SET admin = $2 WHERE "userId" = $1', [userId, admin]);
  }

  public async changeUsersEditorRoleByUserId({ userId, editor }: { userId: string; editor: boolean }): Promise<void> {
    await this.query('UPDATE users SET editor = $2 WHERE "userId" = $1', [userId, editor]);
  }

  public async changeUsersModeratorRoleByUserId({ userId, moderator }: { userId: string; moderator: boolean }): Promise<void> {
    await this.query('UPDATE users SET moderator = $2 WHERE "userId" = $1', [userId, moderator]);
  }

  public async findOneUserByUserId({ userId }: { userId: string }): Promise<User | null> {
    return (await this.query<User>('SELECT * FROM users WHERE "userId" = $1', [userId]))[0] ?? null;
  }

  public async findOneUserByUsername({ username }: { username: string }): Promise<User | null> {
    return (await this.query<User>('SELECT * FROM users WHERE username = $1', [username]))[0] ?? null;
  }

  public async findDisplayNamesByUserIds({ userIds }: { userIds: string[] }): Promise<UserDisplayName[]> {
    const ids = [...new Set(userIds)];
    if (!ids.length) return [];
    return this.query<UserDisplayName>(`SELECT "userId", "displayName" FROM users WHERE "userId" IN (${ids.map((_, index) => `$${index + 1}`).join(', ')})`, ids);
  }

  public async findAllUsers(): Promise<User[]> {
    return this.query<User>('SELECT * FROM users');
  }

  public async deleteUserByUserId({ userId }: { userId: string }): Promise<void> {
    await this.query('DELETE FROM users WHERE "userId" = $1', [userId]);
  }

  public async postVideo({ videoId, title, description, meta, videoMimeType, thumbnailMimeType, recorded, lastModified, hmac, deleted }: Video): Promise<void> {
    await this.query('INSERT INTO videos ("videoId", title, description, meta, "videoMimeType", "thumbnailMimeType", recorded, "lastModified", hmac, deleted) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [
      videoId,
      title,
      description,
      JSON.stringify(meta),
      videoMimeType,
      thumbnailMimeType,
      recorded,
      lastModified,
      hmac,
      deleted
    ]);
  }

  public async changeVideosTitleByVideoId({ videoId, title, lastModified, hmac }: { videoId: string; title: string; lastModified: Date; hmac: string }): Promise<void> {
    await this.query('UPDATE videos SET title = $2, "lastModified" = $3, hmac = $4 WHERE "videoId" = $1 AND deleted = false', [videoId, title, lastModified, hmac]);
  }

  public async changeVideosDescriptionByVideoId({ videoId, description, lastModified, hmac }: { videoId: string; description: string; lastModified: Date; hmac: string }): Promise<void> {
    await this.query('UPDATE videos SET description = $2, "lastModified" = $3, hmac = $4 WHERE "videoId" = $1 AND deleted = false', [videoId, description, lastModified, hmac]);
  }

  public async changeVideosMetadataByVideoId({ videoId, metadata, lastModified, hmac }: { videoId: string; metadata: Record<string, unknown>; lastModified: Date; hmac: string }): Promise<void> {
    await this.query('UPDATE videos SET meta = $2, "lastModified" = $3, hmac = $4 WHERE "videoId" = $1 AND deleted = false', [videoId, JSON.stringify(metadata), lastModified, hmac]);
  }

  public async changeVideosMimetypesByVideoId({ videoId, videoMimeType, thumbnailMimeType, lastModified, hmac }: { videoId: string; videoMimeType?: string; thumbnailMimeType?: string; lastModified: Date; hmac: string }): Promise<void> {
    await this.query('UPDATE videos SET "videoMimeType" = COALESCE($2, "videoMimeType"), "thumbnailMimeType" = COALESCE($3, "thumbnailMimeType"), "lastModified" = $4, hmac = $5 WHERE "videoId" = $1 AND deleted = false', [
      videoId,
      videoMimeType ?? null,
      thumbnailMimeType ?? null,
      lastModified,
      hmac
    ]);
  }

  public async changeVideosRecordedByVideoId({ videoId, recorded, lastModified, hmac }: { videoId: string; recorded: Date; lastModified: Date; hmac: string }): Promise<void> {
    await this.query('UPDATE videos SET recorded = $2, "lastModified" = $3, hmac = $4 WHERE "videoId" = $1 AND deleted = false', [videoId, recorded, lastModified, hmac]);
  }

  public async findOneVideoByVideoId({ videoId }: { videoId: string }): Promise<Video | null> {
    return (await this.query<Video>('SELECT * FROM videos WHERE "videoId" = $1', [videoId]))[0] ?? null;
  }

  public async findManyVideosLastModified({ since }: { since: Date }): Promise<Video[]> {
    return this.query<Video>('SELECT * FROM videos WHERE "lastModified" >= $1', [since]);
  }

  public async findAllVideos(): Promise<Video[]> {
    return this.query<Video>('SELECT * FROM videos');
  }

  public async deleteVideoByVideoId({ videoId, lastModified }: { videoId: string; lastModified: Date }): Promise<void> {
    await this.query("UPDATE videos SET deleted = true, title = '', description = '', meta = '{}', \"videoMimeType\" = '', \"thumbnailMimeType\" = '', recorded = $3, \"lastModified\" = $2, hmac = '' WHERE \"videoId\" = $1 AND deleted = false", [
      videoId,
      lastModified,
      new Date(0)
    ]);
  }

  public async postComment({ commentId, userId, videoId, content, created, lastModified, edited, deleted, hmac }: Comment): Promise<void> {
    await this.query('INSERT INTO comments ("commentId", "userId", "videoId", content, created, "lastModified", edited, deleted, hmac) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
      commentId,
      userId,
      videoId,
      content,
      created,
      lastModified,
      edited,
      deleted,
      hmac
    ]);
  }

  public async changeCommentsContentByCommentIdAndUserId({ commentId, userId, content, lastModified, hmac }: { commentId: string; userId: string; content: string; lastModified: Date; hmac: string }): Promise<void> {
    await this.query('UPDATE comments SET content = $2, "lastModified" = $3, hmac = $4, edited = true WHERE "commentId" = $1 AND "userId" = $5', [commentId, content, lastModified, hmac, userId]);
  }

  public async changeCommentsContentByCommentId({ commentId, content, lastModified, hmac }: { commentId: string; content: string; lastModified: Date; hmac: string }): Promise<void> {
    await this.query('UPDATE comments SET content = $2, "lastModified" = $3, hmac = $4, edited = true WHERE "commentId" = $1', [commentId, content, lastModified, hmac]);
  }

  public async markCommentAsDeletedByCommentId({ commentId }: { commentId: string }): Promise<void> {
    await this.query('UPDATE comments SET deleted = true, content = \'\' WHERE "commentId" = $1', [commentId]);
  }

  public async markCommentAsDeletedByCommentIdAndUserId({ commentId, userId }: { commentId: string; userId: string }): Promise<void> {
    await this.query('UPDATE comments SET deleted = true, content = \'\' WHERE "commentId" = $1 AND "userId" = $2', [commentId, userId]);
  }

  public async markCommentsAsDeletedByUserId({ userId }: { userId: string }): Promise<void> {
    await this.query('UPDATE comments SET deleted = true, content = \'\' WHERE "userId" = $1', [userId]);
  }

  public async deleteCommentsByVideoId({ videoId }: { videoId: string }): Promise<void> {
    await this.query('DELETE FROM comments WHERE "videoId" = $1', [videoId]);
  }

  public async findManyCommentsByVideoIdSortedByCreatedDescPaginated({ videoId, paginationCursor, paginationSize }: { videoId: string; paginationCursor: string; paginationSize: number }): Promise<[Comment[], string]> {
    if (paginationSize <= 0 || !Number.isSafeInteger(paginationSize)) {
      return [[], ''];
    }

    const limit = paginationSize + 1;
    const page = paginationCursor
      ? await this.query<Comment>(
          `SELECT comment.*
         FROM comments AS cursor_comment
         JOIN comments AS comment ON comment."videoId" = cursor_comment."videoId"
         WHERE cursor_comment."videoId" = $1 AND cursor_comment."commentId" = $3
           AND comment.created <= cursor_comment.created
           AND (comment.created < cursor_comment.created OR comment."commentId" > cursor_comment."commentId")
         ORDER BY comment.created DESC, comment."commentId" ASC
         LIMIT $2`,
          [videoId, limit, paginationCursor]
        )
      : await this.query<Comment>('SELECT * FROM comments WHERE "videoId" = $1 ORDER BY created DESC, "commentId" ASC LIMIT $2', [videoId, limit]);

    if (page.length <= paginationSize) {
      return [page, ''];
    }

    page.pop();
    return [page, page[page.length - 1].commentId];
  }

  public async findOneCommentByCommentId({ commentId }: { commentId: string }): Promise<Comment | null> {
    return (await this.query<Comment>('SELECT * FROM comments WHERE "commentId" = $1', [commentId]))[0] ?? null;
  }

  public async increaseAttemptsCountByUsername({ username, lastAttempt }: { username: string; lastAttempt: Date }): Promise<void> {
    await this.query(
      `INSERT INTO login_attempts (username, attempts, "lastAttempt") VALUES ($1, 1, $2)
       ON CONFLICT (username) DO UPDATE
       SET attempts = login_attempts.attempts + 1, "lastAttempt" = EXCLUDED."lastAttempt"`,
      [username, lastAttempt]
    );
  }

  public async changeAttemptsLastAttemptByUsername({ username, lastAttempt }: { username: string; lastAttempt: Date }): Promise<void> {
    await this.query('UPDATE login_attempts SET "lastAttempt" = $2 WHERE username = $1', [username, lastAttempt]);
  }

  public async clearAttemptsCountByUsername({ username }: { username: string }): Promise<void> {
    await this.query('DELETE FROM login_attempts WHERE username = $1', [username]);
  }

  public async findOneAttemptsCountByUsername({ username }: { username: string }): Promise<AttemptsCount | null> {
    return (await this.query<AttemptsCount>('SELECT * FROM login_attempts WHERE username = $1', [username]))[0] ?? null;
  }

  private async connect(): Promise<Pool> {
    const pool = new Pool(this.config);

    // pg emits errors for idle connections; the pool removes those connections.
    pool.on('error', (error: Error) => console.error('Idle PostgreSQL connection failed', error));

    try {
      await pool.query('SELECT 1');
      return pool;
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  private async pool(): Promise<Pool> {
    if (!this.connection) {
      throw new Error('PostgreSQL database is not open');
    }
    return this.connection;
  }

  private async query<Row extends QueryResultRow>(sql: string, values: (string | number | boolean | Date | null)[] = []): Promise<Row[]> {
    try {
      return (await (await this.pool()).query<Row>(sql, values)).rows;
    } catch (error) {
      this.rethrow(error);
    }
  }

  private rethrow(error: unknown): never {
    if ((error as { code?: string } | null)?.code === '23505') {
      throw new DatabaseConflictError(undefined, { cause: error });
    }
    throw error;
  }
}

export { PostgresqlDatabaseAdapter };
