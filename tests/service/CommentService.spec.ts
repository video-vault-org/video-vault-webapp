import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { Comment } from '@/domain/Comment';
import { CommentService } from '@/service/CommentService';

describe('CommentService', () => {
  const comment: Comment = {
    commentId: 'c1',
    videoId: 'v1',
    userId: 'u1',
    content: 'Original comment',
    created: new Date(100),
    lastModified: new Date(100),
    edited: false,
    deleted: false,
    hmac: 'original-hmac'
  };
  const { commentId, userId, videoId } = comment;
  const content = 'Updated comment';
  const lastModified = new Date(200);
  const hmac = 'updated-hmac';
  let db: InMemoryDatabaseAdapter;
  let service: CommentService;

  beforeEach(() => {
    db = new InMemoryDatabaseAdapter();
    service = new CommentService(db);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('submitComment', () => {
    test('passes the complete comment to the database', async () => {
      const post = jest.spyOn(db, 'postComment').mockResolvedValue(undefined);

      await expect(service.submitComment(comment)).resolves.toBeUndefined();

      expect(post).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledWith(comment);
    });

    test('propagates database errors', async () => {
      const error = new Error('Database unavailable');
      jest.spyOn(db, 'postComment').mockRejectedValueOnce(error);

      await expect(service.submitComment(comment)).rejects.toBe(error);
    });
  });

  describe('changeCommentsContent', () => {
    test('forwards the comment ID, content, modification date and HMAC', async () => {
      const update = jest.spyOn(db, 'changeCommentsContentByCommentId').mockResolvedValue(undefined);
      const parameters = { commentId, content, lastModified, hmac };

      await expect(service.changeCommentsContent(parameters)).resolves.toBeUndefined();

      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(parameters);
    });

    test('updates and marks the requested comment as edited without an author filter', async () => {
      await db.postComment(comment);
      const otherComment = { ...comment, commentId: 'c2' };
      await db.postComment(otherComment);

      await service.changeCommentsContent({ commentId, content, lastModified, hmac });

      expect(await service.findComment({ commentId })).toEqual({ ...comment, content, lastModified, hmac, edited: true });
      expect(await service.findComment({ commentId: otherComment.commentId })).toEqual(otherComment);
    });

    test('propagates database errors', async () => {
      const error = new Error('Database unavailable');
      jest.spyOn(db, 'changeCommentsContentByCommentId').mockRejectedValueOnce(error);

      await expect(service.changeCommentsContent({ commentId, content, lastModified, hmac })).rejects.toBe(error);
    });
  });

  describe('changeOwnCommentsContent', () => {
    test('forwards the comment ID, author ID, content, modification date and HMAC', async () => {
      const update = jest.spyOn(db, 'changeCommentsContentByCommentIdAndUserId').mockResolvedValue(undefined);
      const parameters = { commentId, userId, content, lastModified, hmac };

      await expect(service.changeOwnCommentsContent(parameters)).resolves.toBeUndefined();

      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(parameters);
    });

    test('updates the comment when its author matches', async () => {
      await db.postComment(comment);

      await service.changeOwnCommentsContent({ commentId, userId, content, lastModified, hmac });

      expect(await service.findComment({ commentId })).toEqual({ ...comment, content, lastModified, hmac, edited: true });
    });

    test('leaves the comment unchanged when its author does not match', async () => {
      await db.postComment(comment);

      await service.changeOwnCommentsContent({ commentId, userId: 'other-user', content, lastModified, hmac });

      expect(await service.findComment({ commentId })).toEqual(comment);
    });

    test('propagates database errors', async () => {
      const error = new Error('Database unavailable');
      jest.spyOn(db, 'changeCommentsContentByCommentIdAndUserId').mockRejectedValueOnce(error);

      await expect(service.changeOwnCommentsContent({ commentId, userId, content, lastModified, hmac })).rejects.toBe(error);
    });
  });

  describe('deleteComment', () => {
    test('forwards the comment ID to the database method for marking comments as deleted', async () => {
      const mark = jest.spyOn(db, 'markCommentAsDeletedByCommentId').mockResolvedValue(undefined);

      await expect(service.deleteComment({ commentId })).resolves.toBeUndefined();

      expect(mark).toHaveBeenCalledTimes(1);
      expect(mark).toHaveBeenCalledWith({ commentId });
    });

    test('retains the record, clears its content and leaves other comments intact', async () => {
      await db.postComment(comment);
      const otherComment = { ...comment, commentId: 'c2' };
      await db.postComment(otherComment);

      await service.deleteComment({ commentId });

      expect(await service.findComment({ commentId })).toEqual({ ...comment, content: '', deleted: true });
      expect(await service.findComment({ commentId: otherComment.commentId })).toEqual(otherComment);
      await expect(service.deleteComment({ commentId })).resolves.toBeUndefined();
      expect(await service.findComment({ commentId })).toEqual({ ...comment, content: '', deleted: true });
    });

    test('propagates database errors', async () => {
      const error = new Error('Database unavailable');
      jest.spyOn(db, 'markCommentAsDeletedByCommentId').mockRejectedValueOnce(error);

      await expect(service.deleteComment({ commentId })).rejects.toBe(error);
    });
  });

  describe('deleteOwnComment', () => {
    test('forwards the comment ID and author ID to the database', async () => {
      const mark = jest.spyOn(db, 'markCommentAsDeletedByCommentIdAndUserId').mockResolvedValue(undefined);
      const parameters = { commentId, userId };

      await expect(service.deleteOwnComment(parameters)).resolves.toBeUndefined();

      expect(mark).toHaveBeenCalledTimes(1);
      expect(mark).toHaveBeenCalledWith(parameters);
    });

    test('marks the comment as deleted and clears its content when the author matches', async () => {
      await db.postComment(comment);

      await service.deleteOwnComment({ commentId, userId });

      expect(await service.findComment({ commentId })).toEqual({ ...comment, content: '', deleted: true });
    });

    test('leaves the comment unchanged when its author does not match', async () => {
      await db.postComment(comment);

      await service.deleteOwnComment({ commentId, userId: 'other-user' });

      expect(await service.findComment({ commentId })).toEqual(comment);
    });

    test('propagates database errors', async () => {
      const error = new Error('Database unavailable');
      jest.spyOn(db, 'markCommentAsDeletedByCommentIdAndUserId').mockRejectedValueOnce(error);

      await expect(service.deleteOwnComment({ commentId, userId })).rejects.toBe(error);
    });
  });

  describe('findComment', () => {
    test.each([
      ['found', comment],
      ['missing', null]
    ] as const)('returns a %s comment result', async (_label, result) => {
      const find = jest.spyOn(db, 'findOneCommentByCommentId').mockResolvedValueOnce(result);

      await expect(service.findComment({ commentId })).resolves.toBe(result);

      expect(find).toHaveBeenCalledTimes(1);
      expect(find).toHaveBeenCalledWith({ commentId });
    });

    test('propagates database errors', async () => {
      const error = new Error('Database unavailable');
      jest.spyOn(db, 'findOneCommentByCommentId').mockRejectedValueOnce(error);

      await expect(service.findComment({ commentId })).rejects.toBe(error);
    });
  });

  describe('findCommentsByVideoIdSortedByCreatedDescPaginated', () => {
    test('forwards pagination parameters and returns the opaque next cursor unchanged', async () => {
      const parameters = { videoId, paginationCursor: 'opaque-current-cursor', paginationSize: 2 };
      const result: [Comment[], string] = [[comment], 'opaque-next-cursor'];
      const find = jest.spyOn(db, 'findManyCommentsByVideoIdSortedByCreatedDescPaginated').mockResolvedValueOnce(result);

      await expect(service.findCommentsByVideoIdSortedByCreatedDescPaginated(parameters)).resolves.toBe(result);

      expect(find).toHaveBeenCalledTimes(1);
      expect(find).toHaveBeenCalledWith(parameters);
    });

    test('returns the first and last pages in creation order and excludes other videos', async () => {
      const newerComment = { ...comment, commentId: 'c2', created: new Date(200) };
      await db.postComment(comment);
      await db.postComment(newerComment);
      await db.postComment({ ...comment, commentId: 'other-video-comment', videoId: 'v2', created: new Date(300) });

      const [firstPage, cursor] = await service.findCommentsByVideoIdSortedByCreatedDescPaginated({ videoId, paginationCursor: '', paginationSize: 1 });

      expect(firstPage).toEqual([newerComment]);
      expect(cursor).not.toBe('');
      expect(await service.findCommentsByVideoIdSortedByCreatedDescPaginated({ videoId, paginationCursor: cursor, paginationSize: 1 })).toEqual([[comment], '']);
    });

    test('returns no comments and an empty cursor for a video without comments', async () => {
      await expect(service.findCommentsByVideoIdSortedByCreatedDescPaginated({ videoId, paginationCursor: '', paginationSize: 10 })).resolves.toEqual([[], '']);
    });

    test('propagates database errors', async () => {
      const error = new Error('Database unavailable');
      jest.spyOn(db, 'findManyCommentsByVideoIdSortedByCreatedDescPaginated').mockRejectedValueOnce(error);

      await expect(service.findCommentsByVideoIdSortedByCreatedDescPaginated({ videoId, paginationCursor: '', paginationSize: 10 })).rejects.toBe(error);
    });
  });
});
