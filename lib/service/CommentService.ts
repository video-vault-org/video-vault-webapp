import { DatabaseAdapter } from '@/db/adapters/DatabaseAdapter';
import { Comment } from '@/domain/Comment';
import { CommentDto } from '@/domain/CommentDto';

/**
 * Coordinates comment content, deletion markers and paginated comment queries.
 */
class CommentService {
  private readonly db: DatabaseAdapter;

  /**
   * @param db The database adapter used for comments.
   */
  public constructor(db: DatabaseAdapter) {
    this.db = db;
  }

  /**
   * Saves a new comment with the supplied content and metadata.
   * @param comment The comment to save.
   * @throws If the database write fails.
   */
  public async submitComment(comment: Comment): Promise<void> {
    await this.db.postComment(comment);
  }

  /**
   * Updates a comment's content, modification date and HMAC, and marks it as edited.
   * Matches only the comment ID, without checking its author.
   * @param commentId The ID of the comment to update.
   * @param content The new content.
   * @param lastModified The new modification date.
   * @param hmac The HMAC for the updated comment.
   * @throws If the database update fails.
   */
  public async changeCommentsContent({ commentId, content, lastModified, hmac }: { commentId: string; content: string; lastModified: Date; hmac: string }): Promise<void> {
    await this.db.changeCommentsContentByCommentId({ commentId, content, lastModified, hmac });
  }

  /**
   * Updates the acting user's own comment content, modification date and HMAC, and marks it as edited.
   * @param commentId The ID of the comment to update.
   * @param userId The acting user's ID; the comment must belong to this user.
   * @param content The new content.
   * @param lastModified The new modification date.
   * @param hmac The HMAC for the updated comment.
   * @throws If the database update fails.
   */
  public async changeOwnCommentsContent({ commentId, userId, content, lastModified, hmac }: { commentId: string; userId: string; content: string; lastModified: Date; hmac: string }): Promise<void> {
    await this.db.changeCommentsContentByCommentIdAndUserId({ commentId, userId, content, lastModified, hmac });
  }

  /**
   * Marks a comment as deleted and sets its content to an empty string.
   * Retains the comment record and matches only its ID, without checking its author.
   * @param commentId The ID of the comment to mark as deleted.
   * @throws If the database update fails.
   */
  public async deleteComment({ commentId }: { commentId: string }): Promise<void> {
    await this.db.markCommentAsDeletedByCommentId({ commentId });
  }

  /**
   * Marks the acting user's own comment as deleted and clears its content, retaining the record.
   * @param commentId The ID of the comment to mark as deleted.
   * @param userId The acting user's ID; the comment must belong to this user.
   * @throws If the database update fails.
   */
  public async deleteOwnComment({ commentId, userId }: { commentId: string; userId: string }): Promise<void> {
    await this.db.markCommentAsDeletedByCommentIdAndUserId({ commentId, userId });
  }

  /**
   * Finds a comment by its ID, including comments marked as deleted, without loading author names.
   * @param commentId The ID of the comment to find.
   * @returns The comment, or null if no matching comment exists.
   * @throws If the database query fails.
   */
  public async findComment({ commentId }: { commentId: string }): Promise<Comment | null> {
    return await this.db.findOneCommentByCommentId({ commentId });
  }

  /**
   * Finds a video's comments in descending creation order using cursor pagination.
   * Loads current author names in one batch per page (split as needed by the adapter); missing users have displayName null.
   * Author names are response metadata, excluded from the comment HMAC.
   * @param videoId The ID of the video whose comments to find.
   * @param paginationCursor The opaque cursor from the previous page, or an empty string for the first page.
   * @param paginationSize The desired page size.
   * @returns The comments and the next cursor, or an empty cursor if there is no next page.
   * @throws If the database query fails.
   */
  public async findCommentsByVideoIdSortedByCreatedDescPaginated({ videoId, paginationCursor, paginationSize }: { videoId: string; paginationCursor: string; paginationSize: number }): Promise<[CommentDto[], string]> {
    const [items, cursor] = await this.db.findManyCommentsByVideoIdSortedByCreatedDescPaginated({ videoId, paginationCursor, paginationSize });
    return [await this.withDisplayNames(items), cursor];
  }

  private async withDisplayNames(items: Comment[]): Promise<CommentDto[]> {
    if (!items.length) return [];
    const userIds = [...new Set(items.map((item) => item.userId))];
    const names = new Map((await this.db.findDisplayNamesByUserIds({ userIds })).map(({ userId, displayName }) => [userId, displayName]));
    return items.map((item) => ({ ...item, displayName: names.get(item.userId) ?? null }));
  }
}

export { CommentService };
