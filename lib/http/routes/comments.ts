import { Router } from 'express';
import { z } from 'zod';
import { AuthService } from '@/service/AuthService';
import { CommentService } from '@/service/CommentService';
import { VideoService } from '@/service/VideoService';
import { authorization, currentUser } from '../middleware';
import { HttpError } from '../errors';
import { commentChange, date, id, text } from '../validation';

/** Builds comment routes; the parent router must authenticate every request first. */
function commentRoutes(comments: CommentService, videos: VideoService, auth: AuthService): Router {
  const router = Router();
  const moderator = authorization(auth, ['moderator']);
  const requireComment = async (commentId: string, userId?: string) => {
    const comment = await comments.findComment({ commentId });
    if (!comment || (userId !== undefined && comment.userId !== userId)) throw new HttpError(404, 'Comment not found');
    return comment;
  };

  /** POST /api/comment/submit — Any authenticated user. Author comes from the JWT; edited and deleted start as false. */
  router.post('/comment/submit', async (request, response) => {
    const input = z
      .object({ commentId: id, videoId: id, content: z.string().max(1_000_000), created: date, lastModified: date, hmac: text })
      .strict()
      .parse(request.body);
    if (!(await videos.findVideo({ videoId: input.videoId }))) throw new HttpError(404, 'Video not found');
    if (await comments.findComment({ commentId: input.commentId })) throw new HttpError(409, 'Comment already exists');
    const comment = { ...input, userId: currentUser(response).userId, edited: false, deleted: false };
    await comments.submitComment(comment);
    response.status(201).json(comment);
  });

  /** GET /api/comments/:videoId?cursor=&pagesize=100 — Any authenticated user. Newest first; returns { comments, cursor }. */
  router.get('/comments/:videoId', async (request, response) => {
    const { cursor, pagesize } = z
      .object({ cursor: z.string().max(4096).default(''), pagesize: z.coerce.number().int().min(1).max(1000).default(100) })
      .strict()
      .parse(request.query);
    let result: Awaited<ReturnType<CommentService['findCommentsByVideoIdSortedByCreatedDescPaginated']>>;
    try {
      result = await comments.findCommentsByVideoIdSortedByCreatedDescPaginated({ videoId: id.parse(request.params.videoId), paginationCursor: cursor, paginationSize: pagesize });
    } catch (error) {
      if (error instanceof RangeError) throw new HttpError(400, 'Invalid pagination cursor');
      throw error;
    }
    const [items, nextCursor] = result;
    response.json({ comments: items, cursor: nextCursor });
  });

  /** GET /api/comment/find/:commentId — Any authenticated user. Includes comments marked as deleted. */
  router.get('/comment/find/:commentId', async (request, response) => {
    response.json(await requireComment(id.parse(request.params.commentId)));
  });

  /** PATCH /api/comment/change/own/:commentId — Any authenticated user. Updates only their own comment. */
  router.patch('/comment/change/own/:commentId', async (request, response) => {
    const commentId = id.parse(request.params.commentId);
    const userId = currentUser(response).userId;
    const change = commentChange.parse(request.body);
    await requireComment(commentId, userId);
    await comments.changeOwnCommentsContent({ commentId, userId, ...change });
    response.sendStatus(204);
  });

  /** PATCH /api/comment/change/:commentId — Moderators only. Updates a specific comment regardless of author. */
  router.patch('/comment/change/:commentId', moderator, async (request, response) => {
    const commentId = id.parse(request.params.commentId);
    const change = commentChange.parse(request.body);
    await requireComment(commentId);
    await comments.changeCommentsContent({ commentId, ...change });
    response.sendStatus(204);
  });

  /** DELETE /api/comment/delete/own/:commentId — Any authenticated user. Marks their own comment deleted and clears its content. */
  router.delete('/comment/delete/own/:commentId', async (request, response) => {
    const commentId = id.parse(request.params.commentId);
    const userId = currentUser(response).userId;
    await requireComment(commentId, userId);
    await comments.deleteOwnComment({ commentId, userId });
    response.sendStatus(204);
  });

  /** DELETE /api/comment/delete/:commentId — Moderators only. Marks a specific comment deleted and clears its content. */
  router.delete('/comment/delete/:commentId', moderator, async (request, response) => {
    const commentId = id.parse(request.params.commentId);
    await requireComment(commentId);
    await comments.deleteComment({ commentId });
    response.sendStatus(204);
  });
  return router;
}

export { commentRoutes };
