import * as os from 'node:os';
import mongoose from 'mongoose';
import { DatabaseAdapter } from '@/db/adapters/DatabaseAdapter';
import { MongoDatabaseConf } from '@/db/config/MongoDatabaseConf';
import { AttemptsCount } from '@/domain/AttemptsCount';
import { Comment } from '@/domain/Comment';
import { User } from '@/domain/User';
import { Video } from '@/domain/Video';

const { MongoClient } = mongoose.mongo;
const withoutId = { projection: { _id: 0 } };

interface MongoConnection {
  client: mongoose.mongo.MongoClient;
  supportsTransactions: boolean;
}

class MongoDatabaseAdapter implements DatabaseAdapter {
  private connection?: Promise<MongoConnection>;
  private readonly config: MongoDatabaseConf;

  public constructor(config: MongoDatabaseConf) {
    this.config = config;
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
    this.connection = undefined;
    const opened = await connection?.catch(() => undefined);
    await opened?.client.close();
  }

  public async initialize(): Promise<void> {
    const db = await this.database();
    await db.collection<User>('users').createIndexes([
      { key: { userId: 1 }, unique: true },
      { key: { username: 1 }, unique: true }
    ]);
    await db.collection<Video>('videos').createIndexes([{ key: { videoId: 1 }, unique: true }, { key: { lastModified: 1 } }]);
    await db.collection<Comment>('comments').createIndexes([{ key: { commentId: 1 }, unique: true }, { key: { videoId: 1, created: -1, commentId: 1 } }, { key: { userId: 1 } }]);
    await db.collection<AttemptsCount>('login_attempts').createIndexes([{ key: { username: 1 }, unique: true }]);
  }

  public async createUser(user: User): Promise<void> {
    await (await this.users()).insertOne({ ...user });
  }

  public async changeUsersDisplayNameByUserId({ userId, displayName }: { userId: string; displayName: string }): Promise<void> {
    await (await this.users()).updateOne({ userId }, { $set: { displayName } });
  }

  public async changeUsersUsernameByUserId({ userId, username }: { userId: string; username: string }): Promise<void> {
    await (await this.users()).updateOne({ userId }, { $set: { username } });
  }

  public async changeUsersPasswordByUserId({ userId, loginHash, passwordKeySalt, userKey }: { userId: string; loginHash: string; passwordKeySalt: string; userKey: string }): Promise<void> {
    await (await this.users()).updateOne({ userId }, { $set: { loginHash, passwordKeySalt, userKey } });
  }

  public async changeUsersAdminRoleByUserId({ userId, admin }: { userId: string; admin: boolean }): Promise<void> {
    await (await this.users()).updateOne({ userId }, { $set: { admin } });
  }

  public async changeUsersEditorRoleByUserId({ userId, editor }: { userId: string; editor: boolean }): Promise<void> {
    await (await this.users()).updateOne({ userId }, { $set: { editor } });
  }

  public async changeUsersModeratorRoleByUserId({ userId, moderator }: { userId: string; moderator: boolean }): Promise<void> {
    await (await this.users()).updateOne({ userId }, { $set: { moderator } });
  }

  public async findOneUserByUserId({ userId }: { userId: string }): Promise<User | null> {
    return (await this.users()).findOne<User>({ userId }, withoutId);
  }

  public async findOneUserByUsername({ username }: { username: string }): Promise<User | null> {
    return (await this.users()).findOne<User>({ username }, withoutId);
  }

  public async findAllUsers(): Promise<User[]> {
    return (await this.users()).find<User>({}, withoutId).toArray();
  }

  public async deleteUserByUserId({ userId }: { userId: string }): Promise<void> {
    await (await this.users()).deleteOne({ userId });
  }

  public async postVideo(video: Video): Promise<void> {
    await (await this.videos()).insertOne({ ...video });
  }

  public async changeVideosTitleByVideoId({ videoId, title, lastModified, hmac }: { videoId: string; title: string; lastModified: Date; hmac: string }): Promise<void> {
    await (await this.videos()).updateOne({ videoId }, { $set: { title, lastModified, hmac } });
  }

  public async changeVideosMetadataByVideoId({ videoId, metadata, lastModified, hmac }: { videoId: string; metadata: Record<string, unknown>; lastModified: Date; hmac: string }): Promise<void> {
    await (await this.videos()).updateOne({ videoId }, { $set: { meta: metadata, lastModified, hmac } });
  }

  public async changeVideosVideoMimetypeByVideoId({ videoId, mimetype, lastModified, hmac }: { videoId: string; mimetype: string; lastModified: Date; hmac: string }): Promise<void> {
    await (await this.videos()).updateOne({ videoId }, { $set: { videoMimeType: mimetype, lastModified, hmac } });
  }

  public async changeVideosThumbnailMimetypeByVideoId({ videoId, mimetype, lastModified, hmac }: { videoId: string; mimetype: string; lastModified: Date; hmac: string }): Promise<void> {
    await (await this.videos()).updateOne({ videoId }, { $set: { thumbnailMimeType: mimetype, lastModified, hmac } });
  }

  public async findOneVideoByVideoId({ videoId }: { videoId: string }): Promise<Video | null> {
    return (await this.videos()).findOne<Video>({ videoId }, withoutId);
  }

  public async findManyVideosLastModified({ since }: { since: Date }): Promise<Video[]> {
    return (await this.videos()).find<Video>({ lastModified: { $gte: since } }, withoutId).toArray();
  }

  public async findAllVideos(): Promise<Video[]> {
    return (await this.videos()).find<Video>({}, withoutId).toArray();
  }

  public async deleteVideoByVideoId({ videoId }: { videoId: string }): Promise<void> {
    await (await this.videos()).deleteOne({ videoId });
  }

  public async postComment(comment: Comment): Promise<void> {
    await (await this.comments()).insertOne({ ...comment });
  }

  public async changeCommentsContentByCommentIdAndUserId({ commentId, userId, content, lastModified, hmac }: { commentId: string; userId: string; content: string; lastModified: Date; hmac: string }): Promise<void> {
    await (await this.comments()).updateOne({ commentId, userId }, { $set: { content, lastModified, hmac, edited: true } });
  }

  public async changeCommentsContentByCommentId({ commentId, content, lastModified, hmac }: { commentId: string; content: string; lastModified: Date; hmac: string }): Promise<void> {
    await (await this.comments()).updateOne({ commentId }, { $set: { content, lastModified, hmac, edited: true } });
  }

  public async markCommentAsDeletedByCommentId({ commentId }: { commentId: string }): Promise<void> {
    await (await this.comments()).updateOne({ commentId }, { $set: { deleted: true, content: '' } });
  }

  public async markCommentAsDeletedByCommentIdAndUserId({ commentId, userId }: { commentId: string; userId: string }): Promise<void> {
    await (await this.comments()).updateOne({ commentId, userId }, { $set: { deleted: true, content: '' } });
  }

  public async markCommentsAsDeletedByUserId({ userId }: { userId: string }): Promise<void> {
    await this.writeManyComments((comments, session) => comments.updateMany({ userId }, { $set: { deleted: true, content: '' } }, { session }));
  }

  public async deleteCommentsByVideoId({ videoId }: { videoId: string }): Promise<void> {
    await this.writeManyComments((comments, session) => comments.deleteMany({ videoId }, { session }));
  }

  public async findManyCommentsByVideoIdSortedByCreatedDescPaginated({ videoId, paginationCursor, paginationSize }: { videoId: string; paginationCursor: string; paginationSize: number }): Promise<[Comment[], string]> {
    if (!Number.isSafeInteger(paginationSize) || paginationSize <= 0) {
      return [[], ''];
    }

    const comments = await this.comments();
    const filter: mongoose.mongo.Filter<Comment> = { videoId };
    if (paginationCursor) {
      const cursor = await comments.findOne<Pick<Comment, 'created'>>({ videoId, commentId: paginationCursor }, { projection: { _id: 0, created: 1 } });
      if (!cursor) {
        return [[], ''];
      }
      filter.$or = [{ created: { $lt: cursor.created } }, { created: cursor.created, commentId: { $gt: paginationCursor } }];
    }

    const page = await comments
      .find<Comment>(filter, withoutId)
      .sort({ created: -1, commentId: 1 })
      .limit(paginationSize + 1)
      .toArray();
    if (page.length <= paginationSize) {
      return [page, ''];
    }

    page.pop();
    return [page, page[page.length - 1].commentId];
  }

  public async findOneCommentByCommentId({ commentId }: { commentId: string }): Promise<Comment | null> {
    return (await this.comments()).findOne<Comment>({ commentId }, withoutId);
  }

  public async increaseAttemptsCountByUsername({ username, lastAttempt }: { username: string; lastAttempt: Date }): Promise<void> {
    await (await this.attempts()).updateOne({ username }, { $inc: { attempts: 1 }, $set: { lastAttempt } }, { upsert: true });
  }

  public async clearAttemptsCountByUsername({ username }: { username: string }): Promise<void> {
    await (await this.attempts()).deleteOne({ username });
  }

  public async findOneAttemptsCountByUsername({ username }: { username: string }): Promise<AttemptsCount | null> {
    return (await this.attempts()).findOne<AttemptsCount>({ username }, withoutId);
  }

  private async connect(): Promise<MongoConnection> {
    const { url, user, pass } = this.config;
    const auth = user === undefined ? undefined : { username: user, password: pass ?? '' };
    const client = new MongoClient(url, { auth, serverSelectionTimeoutMS: 5000, runtimeAdapters: { os } });
    try {
      await client.connect();
      const hello = await client.db('admin').command({ hello: 1 });
      return { client, supportsTransactions: Boolean(hello.setName) || hello.msg === 'isdbgrid' };
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  private async openedConnection(): Promise<MongoConnection> {
    if (!this.connection) {
      throw new Error('MongoDB database is not open');
    }
    return this.connection;
  }

  private async database(): Promise<mongoose.mongo.Db> {
    return (await this.openedConnection()).client.db();
  }

  private async users(): Promise<mongoose.mongo.Collection<User>> {
    return (await this.database()).collection<User>('users');
  }

  private async videos(): Promise<mongoose.mongo.Collection<Video>> {
    return (await this.database()).collection<Video>('videos');
  }

  private async comments(): Promise<mongoose.mongo.Collection<Comment>> {
    return (await this.database()).collection<Comment>('comments');
  }

  private async attempts(): Promise<mongoose.mongo.Collection<AttemptsCount>> {
    return (await this.database()).collection<AttemptsCount>('login_attempts');
  }

  private async writeManyComments(write: (comments: mongoose.mongo.Collection<Comment>, session?: mongoose.mongo.ClientSession) => Promise<unknown>): Promise<void> {
    const { client, supportsTransactions } = await this.openedConnection();
    const comments = client.db().collection<Comment>('comments');
    if (supportsTransactions) {
      await client.withSession((session) => session.withTransaction(() => write(comments, session)));
    } else {
      await write(comments);
    }
  }
}

export { MongoDatabaseAdapter };
