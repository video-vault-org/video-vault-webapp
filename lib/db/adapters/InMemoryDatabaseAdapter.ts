import { DatabaseConflictError } from '@/db/errors/DatabaseConflictError';
import { DatabaseAdapter } from '@/db/adapters/DatabaseAdapter';
import { User } from '@/domain/User';
import { Video } from '@/domain/Video';
import { Comment } from '@/domain/Comment';
import { AttemptsCount } from '@/domain/AttemptsCount';

class InMemoryDatabaseAdapter implements DatabaseAdapter {
  private users: User[] = [];
  private videos: Video[] = [];
  private comments: Comment[] = [];
  private attempts: AttemptsCount[] = [];
  private opened: boolean | undefined;

  public constructor() {
    // left blank intentionally
  }

  public async open(): Promise<void> {
    this.opened = true;
  }

  public async close(): Promise<void> {
    this.opened = false;
  }

  public async initialize(): Promise<void> {
    this.users = [];
    this.videos = [];
    this.comments = [];
    this.attempts = [];
  }

  public async createUser(user: User): Promise<void> {
    if (this.users.some((existing) => existing.username === user.username)) {
      throw new DatabaseConflictError('Username already exists');
    }
    this.users.push({ ...user });
  }

  public async changeUsersDisplayNameByUserId({ userId, displayName }: { userId: string; displayName: string }): Promise<void> {
    const user = this.users.find((user) => user.userId === userId);
    if (!user) {
      return;
    }
    user.displayName = displayName;
  }

  public async changeUsersUsernameByUserId({ userId, username, loginHash }: { userId: string; username: string; loginHash: string }): Promise<void> {
    const user = this.users.find((user) => user.userId === userId);
    if (!user) {
      return;
    }
    if (this.users.some((existing) => existing !== user && existing.username === username)) {
      throw new DatabaseConflictError('Username already exists');
    }
    user.username = username;
    user.loginHash = loginHash;
  }

  public async changeUsersPasswordByUserId({ userId, loginHash, passwordKeySalt, userKey }: { userId: string; loginHash: string; passwordKeySalt: string; userKey: string }): Promise<void> {
    const user = this.users.find((user) => user.userId === userId);
    if (!user) {
      return;
    }
    user.loginHash = loginHash;
    user.passwordKeySalt = passwordKeySalt;
    user.userKey = userKey;
  }

  public async changeUsersAdminRoleByUserId({ userId, admin }: { userId: string; admin: boolean }): Promise<void> {
    const user = this.users.find((user) => user.userId === userId);
    if (!user) {
      return;
    }
    user.admin = admin;
  }

  public async changeUsersEditorRoleByUserId({ userId, editor }: { userId: string; editor: boolean }): Promise<void> {
    const user = this.users.find((user) => user.userId === userId);
    if (!user) {
      return;
    }
    user.editor = editor;
  }

  public async changeUsersModeratorRoleByUserId({ userId, moderator }: { userId: string; moderator: boolean }): Promise<void> {
    const user = this.users.find((user) => user.userId === userId);
    if (!user) {
      return;
    }
    user.moderator = moderator;
  }

  public async findOneUserByUserId({ userId }: { userId: string }): Promise<User | null> {
    return this.users.find((user) => user.userId === userId) ?? null;
  }

  public async findOneUserByUsername({ username }: { username: string }): Promise<User | null> {
    return this.users.find((user) => user.username === username) ?? null;
  }

  public async findAllUsers(): Promise<User[]> {
    return this.users;
  }

  public async deleteUserByUserId({ userId }: { userId: string }): Promise<void> {
    const userIndex = this.users.findIndex((user) => user.userId === userId);
    if (userIndex < 0) {
      return;
    }
    this.users.splice(userIndex, 1);
  }

  public async postVideo(video: Video): Promise<void> {
    if (this.videos.some((item) => item.videoId === video.videoId)) {
      throw new DatabaseConflictError();
    }
    this.videos.push({ ...video });
  }

  public async changeVideosTitleByVideoId({ videoId, title, lastModified, hmac }: { videoId: string; title: string; lastModified: Date; hmac: string }): Promise<void> {
    const video = this.videos.find((video) => video.videoId === videoId);
    if (!video || video.deleted) {
      return;
    }
    video.title = title;
    video.lastModified = lastModified;
    video.hmac = hmac;
  }

  public async changeVideosDescriptionByVideoId({ videoId, description, lastModified, hmac }: { videoId: string; description: string; lastModified: Date; hmac: string }): Promise<void> {
    const video = this.videos.find((video) => video.videoId === videoId);
    if (!video || video.deleted) {
      return;
    }
    video.description = description;
    video.lastModified = lastModified;
    video.hmac = hmac;
  }

  public async changeVideosMetadataByVideoId({ videoId, metadata, lastModified, hmac }: { videoId: string; metadata: Record<string, unknown>; lastModified: Date; hmac: string }): Promise<void> {
    const video = this.videos.find((video) => video.videoId === videoId);
    if (!video || video.deleted) {
      return;
    }
    video.meta = metadata;
    video.lastModified = lastModified;
    video.hmac = hmac;
  }

  public async changeVideosMimetypesByVideoId({ videoId, videoMimeType, thumbnailMimeType, lastModified, hmac }: { videoId: string; videoMimeType?: string; thumbnailMimeType?: string; lastModified: Date; hmac: string }): Promise<void> {
    const video = this.videos.find((item) => item.videoId === videoId);
    if (!video || video.deleted) return;
    if (videoMimeType !== undefined) video.videoMimeType = videoMimeType;
    if (thumbnailMimeType !== undefined) video.thumbnailMimeType = thumbnailMimeType;
    video.lastModified = lastModified;
    video.hmac = hmac;
  }

  public async changeVideosRecordedByVideoId({ videoId, recorded, lastModified, hmac }: { videoId: string; recorded: Date; lastModified: Date; hmac: string }): Promise<void> {
    const video = this.videos.find((video) => video.videoId === videoId);
    if (!video || video.deleted) {
      return;
    }
    video.recorded = recorded;
    video.lastModified = lastModified;
    video.hmac = hmac;
  }

  public async findOneVideoByVideoId({ videoId }: { videoId: string }): Promise<Video | null> {
    return this.videos.find((video) => video.videoId === videoId) ?? null;
  }

  public async findManyVideosLastModified({ since }: { since: Date }): Promise<Video[]> {
    return this.videos.filter((video) => video.lastModified.getTime() >= since.getTime());
  }

  public async findAllVideos(): Promise<Video[]> {
    return this.videos;
  }

  public async deleteVideoByVideoId({ videoId, lastModified }: { videoId: string; lastModified: Date }): Promise<void> {
    const video = this.videos.find((item) => item.videoId === videoId);
    if (!video || video.deleted) return;
    Object.assign(video, { deleted: true, title: '', description: '', meta: {}, videoMimeType: '', thumbnailMimeType: '', recorded: new Date(0), lastModified, hmac: '' });
  }

  public async postComment(comment: Comment): Promise<void> {
    this.comments.push({ ...comment });
  }

  public async changeCommentsContentByCommentIdAndUserId({ commentId, userId, content, lastModified, hmac }: { commentId: string; userId: string; content: string; lastModified: Date; hmac: string }): Promise<void> {
    const comment = this.comments.find((comment) => comment.commentId === commentId && comment.userId === userId);
    if (!comment) {
      return;
    }
    comment.content = content;
    comment.lastModified = lastModified;
    comment.hmac = hmac;
    comment.edited = true;
  }

  public async changeCommentsContentByCommentId({ commentId, content, lastModified, hmac }: { commentId: string; content: string; lastModified: Date; hmac: string }): Promise<void> {
    const comment = this.comments.find((comment) => comment.commentId === commentId);
    if (!comment) {
      return;
    }
    comment.content = content;
    comment.lastModified = lastModified;
    comment.hmac = hmac;
    comment.edited = true;
  }

  public async markCommentAsDeletedByCommentId({ commentId }: { commentId: string }): Promise<void> {
    const comment = this.comments.find((comment) => comment.commentId === commentId);
    if (!comment) {
      return;
    }
    comment.deleted = true;
    comment.content = '';
  }

  public async markCommentAsDeletedByCommentIdAndUserId({ commentId, userId }: { commentId: string; userId: string }): Promise<void> {
    const comment = this.comments.find((comment) => comment.commentId === commentId && comment.userId === userId);
    if (!comment) {
      return;
    }
    comment.deleted = true;
    comment.content = '';
  }

  public async markCommentsAsDeletedByUserId({ userId }: { userId: string }): Promise<void> {
    for (const comment of this.comments) {
      if (comment.userId === userId) {
        comment.deleted = true;
        comment.content = '';
      }
    }
  }

  public async deleteCommentsByVideoId({ videoId }: { videoId: string }): Promise<void> {
    this.comments = this.comments.filter((comment) => comment.videoId !== videoId);
  }

  public async findManyCommentsByVideoIdSortedByCreatedDescPaginated({ videoId, paginationCursor, paginationSize }: { videoId: string; paginationCursor: string; paginationSize: number }): Promise<[Comment[], string]> {
    if (paginationSize <= 0 || !Number.isSafeInteger(paginationSize)) {
      return [[], ''];
    }

    const comments = this.comments.filter((comment) => comment.videoId === videoId).sort((left, right) => right.created.getTime() - left.created.getTime() || left.commentId.localeCompare(right.commentId));

    let start = 0;
    if (paginationCursor) {
      const index = comments.findIndex((comment) => comment.commentId === paginationCursor);
      if (index < 0) {
        return [[], ''];
      }
      start = index + 1;
    }

    const page = comments.slice(start, start + paginationSize + 1);
    if (page.length <= paginationSize) {
      return [page, ''];
    }

    page.pop();
    return [page, page[page.length - 1].commentId];
  }

  public async findOneCommentByCommentId({ commentId }: { commentId: string }): Promise<Comment | null> {
    return this.comments.find((comment) => comment.commentId === commentId) ?? null;
  }

  public async increaseAttemptsCountByUsername({ username, lastAttempt }: { username: string; lastAttempt: Date }): Promise<void> {
    const count = this.attempts.find((count) => count.username === username);
    if (!count) {
      this.attempts.push({ username, attempts: 1, lastAttempt });
      return;
    }
    count.attempts++;
    count.lastAttempt = lastAttempt;
  }

  public async changeAttemptsLastAttemptByUsername({ username, lastAttempt }: { username: string; lastAttempt: Date }): Promise<void> {
    const count = this.attempts.find((count) => count.username === username);
    if (count) {
      count.lastAttempt = lastAttempt;
    }
  }

  public async clearAttemptsCountByUsername({ username }: { username: string }): Promise<void> {
    const index = this.attempts.findIndex((count) => count.username === username);
    if (index < 0) {
      return;
    }
    this.attempts.splice(index, 1);
  }

  public async findOneAttemptsCountByUsername({ username }: { username: string }): Promise<AttemptsCount | null> {
    return this.attempts.find((count) => count.username === username) ?? null;
  }
}

export { InMemoryDatabaseAdapter };
