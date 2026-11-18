import { DatabaseSync } from 'node:sqlite';
import { DatabaseAdapter } from '@/db/adapters/DatabaseAdapter';
import { AttemptsCount } from '@/domain/AttemptsCount';
import { Comment } from '@/domain/Comment';
import { User } from '@/domain/User';
import { Video } from '@/domain/Video';
import { SqliteDatabaseConf } from '@/db/config/SqliteDatabaseConf';

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    "userId" text NOT NULL PRIMARY KEY,
    username text NOT NULL UNIQUE,
    "displayName" text NOT NULL,
    "loginHash" text NOT NULL,
    "passwordKeySalt" text NOT NULL,
    "userKey" text NOT NULL,
    admin integer NOT NULL,
    editor integer NOT NULL,
    moderator integer NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS videos (
    "videoId" text NOT NULL PRIMARY KEY,
    title text NOT NULL,
    meta text NOT NULL,
    "videoMimeType" text NOT NULL,
    "thumbnailMimeType" text NOT NULL,
    "lastModified" integer NOT NULL,
    hmac text NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS comments (
    "commentId" text NOT NULL PRIMARY KEY,
    "userId" text NOT NULL,
    "videoId" text NOT NULL,
    content text NOT NULL,
    created integer NOT NULL,
    "lastModified" integer NOT NULL,
    edited integer NOT NULL,
    deleted integer NOT NULL,
    hmac text NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS login_attempts (
    username text NOT NULL PRIMARY KEY,
    attempts integer NOT NULL,
    "lastAttempt" integer NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS videos_last_modified_idx ON videos ("lastModified");
  CREATE INDEX IF NOT EXISTS comments_video_created_idx ON comments ("videoId", created DESC, "commentId");
  CREATE INDEX IF NOT EXISTS comments_user_idx ON comments ("userId");
`;

type UserRow = Omit<User, 'admin' | 'editor' | 'moderator'> & { admin: number; editor: number; moderator: number };
type VideoRow = Omit<Video, 'meta' | 'lastModified'> & { meta: string; lastModified: number };
type CommentRow = Omit<Comment, 'created' | 'lastModified' | 'edited' | 'deleted'> & { created: number; lastModified: number; edited: number; deleted: number };
type AttemptsRow = Omit<AttemptsCount, 'lastAttempt'> & { lastAttempt: number };
type Parameter = string | number | boolean | Date;

const toUser = ({ admin, editor, moderator, ...user }: UserRow): User => ({ ...user, admin: admin === 1, editor: editor === 1, moderator: moderator === 1 });
const toVideo = ({ meta, lastModified, ...video }: VideoRow): Video => ({ ...video, meta: JSON.parse(meta), lastModified: new Date(lastModified) });
const toComment = ({ created, lastModified, edited, deleted, ...comment }: CommentRow): Comment => ({
  ...comment,
  created: new Date(created),
  lastModified: new Date(lastModified),
  edited: edited === 1,
  deleted: deleted === 1
});
const toAttempts = ({ lastAttempt, ...count }: AttemptsRow): AttemptsCount => ({ ...count, lastAttempt: new Date(lastAttempt) });

function bindings(values: Parameter[]): Record<string, string | number> {
  return Object.fromEntries(
    values.map((value, index) => {
      const key = '$' + (index + 1);
      if (value instanceof Date) {
        const time = value.getTime();
        if (!Number.isFinite(time)) {
          throw new RangeError('Invalid SQLite date');
        }
        return [key, time];
      }
      return [key, typeof value === 'boolean' ? Number(value) : value];
    })
  );
}

class SQLiteDatabaseAdapter implements DatabaseAdapter {
  private database?: DatabaseSync;
  private readonly config: SqliteDatabaseConf;

  public constructor(config: SqliteDatabaseConf) {
    this.config = config;
  }

  public async open(): Promise<void> {
    if (!this.database) {
      const database = new DatabaseSync(this.config.filePath);
      try {
        database.exec('PRAGMA busy_timeout = 5000');
        this.database = database;
      } catch (error) {
        database.close();
        throw error;
      }
    }
  }

  public async close(): Promise<void> {
    this.database?.close();
    this.database = undefined;
  }

  public async initialize(): Promise<void> {
    const database = this.connection();
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(schema);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  public async createUser({ userId, username, displayName, loginHash, passwordKeySalt, userKey, admin, editor, moderator }: User): Promise<void> {
    this.write('INSERT INTO users ("userId", username, "displayName", "loginHash", "passwordKeySalt", "userKey", admin, editor, moderator) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
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
    this.write('UPDATE users SET "displayName" = $2 WHERE "userId" = $1', [userId, displayName]);
  }

  public async changeUsersUsernameByUserId({ userId, username }: { userId: string; username: string }): Promise<void> {
    this.write('UPDATE users SET username = $2 WHERE "userId" = $1', [userId, username]);
  }

  public async changeUsersPasswordByUserId({ userId, loginHash, passwordKeySalt, userKey }: { userId: string; loginHash: string; passwordKeySalt: string; userKey: string }): Promise<void> {
    this.write('UPDATE users SET "loginHash" = $2, "passwordKeySalt" = $3, "userKey" = $4 WHERE "userId" = $1', [userId, loginHash, passwordKeySalt, userKey]);
  }

  public async changeUsersAdminRoleByUserId({ userId, admin }: { userId: string; admin: boolean }): Promise<void> {
    this.write('UPDATE users SET admin = $2 WHERE "userId" = $1', [userId, admin]);
  }

  public async changeUsersEditorRoleByUserId({ userId, editor }: { userId: string; editor: boolean }): Promise<void> {
    this.write('UPDATE users SET editor = $2 WHERE "userId" = $1', [userId, editor]);
  }

  public async changeUsersModeratorRoleByUserId({ userId, moderator }: { userId: string; moderator: boolean }): Promise<void> {
    this.write('UPDATE users SET moderator = $2 WHERE "userId" = $1', [userId, moderator]);
  }

  public async findOneUserByUserId({ userId }: { userId: string }): Promise<User | null> {
    return this.findOne(toUser, 'SELECT * FROM users WHERE "userId" = $1', [userId]);
  }

  public async findOneUserByUsername({ username }: { username: string }): Promise<User | null> {
    return this.findOne(toUser, 'SELECT * FROM users WHERE username = $1', [username]);
  }

  public async findAllUsers(): Promise<User[]> {
    return this.find(toUser, 'SELECT * FROM users');
  }

  public async deleteUserByUserId({ userId }: { userId: string }): Promise<void> {
    this.write('DELETE FROM users WHERE "userId" = $1', [userId]);
  }

  public async postVideo({ videoId, title, meta, videoMimeType, thumbnailMimeType, lastModified, hmac }: Video): Promise<void> {
    this.write('INSERT INTO videos ("videoId", title, meta, "videoMimeType", "thumbnailMimeType", "lastModified", hmac) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
      videoId,
      title,
      JSON.stringify(meta),
      videoMimeType,
      thumbnailMimeType,
      lastModified,
      hmac
    ]);
  }

  public async changeVideosTitleByVideoId({ videoId, title, lastModified, hmac }: { videoId: string; title: string; lastModified: Date; hmac: string }): Promise<void> {
    this.write('UPDATE videos SET title = $2, "lastModified" = $3, hmac = $4 WHERE "videoId" = $1', [videoId, title, lastModified, hmac]);
  }

  public async changeVideosMetadataByVideoId({ videoId, metadata, lastModified, hmac }: { videoId: string; metadata: Record<string, unknown>; lastModified: Date; hmac: string }): Promise<void> {
    this.write('UPDATE videos SET meta = $2, "lastModified" = $3, hmac = $4 WHERE "videoId" = $1', [videoId, JSON.stringify(metadata), lastModified, hmac]);
  }

  public async changeVideosVideoMimetypeByVideoId({ videoId, mimetype, lastModified, hmac }: { videoId: string; mimetype: string; lastModified: Date; hmac: string }): Promise<void> {
    this.write('UPDATE videos SET "videoMimeType" = $2, "lastModified" = $3, hmac = $4 WHERE "videoId" = $1', [videoId, mimetype, lastModified, hmac]);
  }

  public async changeVideosThumbnailMimetypeByVideoId({ videoId, mimetype, lastModified, hmac }: { videoId: string; mimetype: string; lastModified: Date; hmac: string }): Promise<void> {
    this.write('UPDATE videos SET "thumbnailMimeType" = $2, "lastModified" = $3, hmac = $4 WHERE "videoId" = $1', [videoId, mimetype, lastModified, hmac]);
  }

  public async findOneVideoByVideoId({ videoId }: { videoId: string }): Promise<Video | null> {
    return this.findOne(toVideo, 'SELECT * FROM videos WHERE "videoId" = $1', [videoId]);
  }

  public async findManyVideosLastModified({ since }: { since: Date }): Promise<Video[]> {
    return this.find(toVideo, 'SELECT * FROM videos WHERE "lastModified" >= $1', [since]);
  }

  public async findAllVideos(): Promise<Video[]> {
    return this.find(toVideo, 'SELECT * FROM videos');
  }

  public async deleteVideoByVideoId({ videoId }: { videoId: string }): Promise<void> {
    this.write('DELETE FROM videos WHERE "videoId" = $1', [videoId]);
  }

  public async postComment({ commentId, userId, videoId, content, created, lastModified, edited, deleted, hmac }: Comment): Promise<void> {
    this.write('INSERT INTO comments ("commentId", "userId", "videoId", content, created, "lastModified", edited, deleted, hmac) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
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
    this.write('UPDATE comments SET content = $2, "lastModified" = $3, hmac = $4, edited = 1 WHERE "commentId" = $1 AND "userId" = $5', [commentId, content, lastModified, hmac, userId]);
  }

  public async changeCommentsContentByCommentId({ commentId, content, lastModified, hmac }: { commentId: string; content: string; lastModified: Date; hmac: string }): Promise<void> {
    this.write('UPDATE comments SET content = $2, "lastModified" = $3, hmac = $4, edited = 1 WHERE "commentId" = $1', [commentId, content, lastModified, hmac]);
  }

  public async markCommentAsDeletedByCommentId({ commentId }: { commentId: string }): Promise<void> {
    this.write('UPDATE comments SET deleted = 1, content = \'\' WHERE "commentId" = $1', [commentId]);
  }

  public async markCommentAsDeletedByCommentIdAndUserId({ commentId, userId }: { commentId: string; userId: string }): Promise<void> {
    this.write('UPDATE comments SET deleted = 1, content = \'\' WHERE "commentId" = $1 AND "userId" = $2', [commentId, userId]);
  }

  public async markCommentsAsDeletedByUserId({ userId }: { userId: string }): Promise<void> {
    this.write('UPDATE comments SET deleted = 1, content = \'\' WHERE "userId" = $1', [userId]);
  }

  public async deleteCommentsByVideoId({ videoId }: { videoId: string }): Promise<void> {
    this.write('DELETE FROM comments WHERE "videoId" = $1', [videoId]);
  }

  public async findManyCommentsByVideoIdSortedByCreatedDescPaginated({ videoId, paginationCursor, paginationSize }: { videoId: string; paginationCursor: string; paginationSize: number }): Promise<[Comment[], string]> {
    if (paginationSize <= 0 || !Number.isSafeInteger(paginationSize)) {
      return [[], ''];
    }

    const limit = paginationSize + 1;
    const page = paginationCursor
      ? this.find(
          toComment,
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
      : this.find(toComment, 'SELECT * FROM comments WHERE "videoId" = $1 ORDER BY created DESC, "commentId" ASC LIMIT $2', [videoId, limit]);

    if (page.length <= paginationSize) {
      return [page, ''];
    }

    page.pop();
    return [page, page[page.length - 1].commentId];
  }

  public async findOneCommentByCommentId({ commentId }: { commentId: string }): Promise<Comment | null> {
    return this.findOne(toComment, 'SELECT * FROM comments WHERE "commentId" = $1', [commentId]);
  }

  public async increaseAttemptsCountByUsername({ username, lastAttempt }: { username: string; lastAttempt: Date }): Promise<void> {
    this.write(
      `INSERT INTO login_attempts (username, attempts, "lastAttempt") VALUES ($1, 1, $2)
       ON CONFLICT (username) DO UPDATE
       SET attempts = login_attempts.attempts + 1, "lastAttempt" = excluded."lastAttempt"`,
      [username, lastAttempt]
    );
  }

  public async clearAttemptsCountByUsername({ username }: { username: string }): Promise<void> {
    this.write('DELETE FROM login_attempts WHERE username = $1', [username]);
  }

  public async findOneAttemptsCountByUsername({ username }: { username: string }): Promise<AttemptsCount | null> {
    return this.findOne(toAttempts, 'SELECT * FROM login_attempts WHERE username = $1', [username]);
  }

  private connection(): DatabaseSync {
    if (!this.database) {
      throw new Error('SQLite database is not open');
    }
    return this.database;
  }

  private write(sql: string, values: Parameter[]): void {
    this.connection().prepare(sql).run(bindings(values));
  }

  private findOne<Row, Item>(decode: (row: Row) => Item, sql: string, values: Parameter[]): Item | null {
    const row = this.connection().prepare(sql).get(bindings(values)) as Row | undefined;
    return row === undefined ? null : decode(row);
  }

  private find<Row, Item>(decode: (row: Row) => Item, sql: string, values: Parameter[] = []): Item[] {
    const rows = this.connection().prepare(sql).all(bindings(values)) as Row[];
    return rows.map(decode);
  }
}

export { SQLiteDatabaseAdapter };
