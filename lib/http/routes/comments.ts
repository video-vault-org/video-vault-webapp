import { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { AuthService } from '@/service/AuthService';
import { CommentService } from '@/service/CommentService';
import { VideoService } from '@/service/VideoService';
import { CommentDto } from '@/domain/CommentDto';
import { authorization, currentUser } from '../middleware';
import { HttpError } from '../errors';
import { Type, object, commentChange, date, id, text, commentDto, errorResponses, noContent } from '../validation';

const publicComment = function (item: CommentDto) {
  return { ...item, created: item.created.toISOString(), lastModified: item.lastModified.toISOString() };
};

/** Registers comment routes; the parent authenticates every API request. */
const commentRoutes = function (app: FastifyInstance, comments: CommentService, videos: VideoService, auth: AuthService): void {
  const router = app.withTypeProvider<TypeBoxTypeProvider>();
  const moderator = authorization(auth, ['moderator']);
  const params = object({ commentId: id });

  const requireComment = async (commentId: string, userId?: string) => {
    const item = await comments.findComment({ commentId });
    if (!item || (userId !== undefined && item.userId !== userId)) throw new HttpError(404, 'Comment not found');
    if ((await videos.findVideo({ videoId: item.videoId }))?.deleted) throw new HttpError(404, 'Video not found');
    return item;
  };

  /** POST /api/comment/submit — Any authenticated user. Author comes from the authenticated session; edited and deleted begin as false. */
  router.post(
    '/comment/submit',
    { schema: { body: object({ commentId: id, videoId: id, content: Type.String({ maxLength: 1_000_000 }), created: date, lastModified: date, hmac: text }), response: { 201: commentDto, ...errorResponses } } },
    async (request, reply) => {
      const input = request.body;
      const parent = await videos.findVideo({ videoId: input.videoId });
      if (!parent || parent.deleted) throw new HttpError(404, 'Video not found');
      if (await comments.findComment({ commentId: input.commentId })) throw new HttpError(409, 'Comment already exists');
      const item = { ...input, created: new Date(input.created), lastModified: new Date(input.lastModified), userId: currentUser(request).userId, edited: false, deleted: false };
      await comments.submitComment(item);
      return reply.code(201).send(publicComment({ ...item, displayName: currentUser(request).displayName }));
    }
  );

  /** GET /api/comments/:videoId?cursor=&pagesize=100 — Any authenticated user. Paginated comments, newest first, with current author names (null for missing users). Names are outside the HMAC. */
  router.get(
    '/comments/:videoId',
    {
      schema: {
        params: object({ videoId: id }),
        querystring: object({ cursor: Type.String({ maxLength: 4096, default: '' }), pagesize: Type.Integer({ minimum: 1, maximum: 1000, default: 100 }) }),
        response: { 200: object({ comments: Type.Array(commentDto), cursor: Type.String() }), ...errorResponses }
      }
    },
    async (request) => {
      try {
        if ((await videos.findVideo({ videoId: request.params.videoId }))?.deleted) throw new HttpError(404, 'Video not found');
        const [items, cursor] = await comments.findCommentsByVideoIdSortedByCreatedDescPaginated({ videoId: request.params.videoId, paginationCursor: request.query.cursor, paginationSize: request.query.pagesize });
        return { comments: items.map(publicComment), cursor };
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(400, 'Invalid pagination cursor');
        throw error;
      }
    }
  );

  /** PATCH /api/comment/change/own/:commentId — Any authenticated user. Changes only their own comment. */
  router.patch('/comment/change/own/:commentId', { schema: { params, body: commentChange, response: noContent } }, async (request, reply) => {
    const userId = currentUser(request).userId;
    const { commentId } = request.params;
    await requireComment(commentId, userId);
    await comments.changeOwnCommentsContent({ commentId, userId, ...request.body, lastModified: new Date(request.body.lastModified) });
    return reply.code(204).send(null);
  });

  /** PATCH /api/comment/change/:commentId — Moderators only. Changes a comment regardless of author. */
  router.patch('/comment/change/:commentId', { onRequest: moderator, schema: { params, body: commentChange, response: noContent } }, async (request, reply) => {
    await requireComment(request.params.commentId);
    await comments.changeCommentsContent({ ...request.params, ...request.body, lastModified: new Date(request.body.lastModified) });
    return reply.code(204).send(null);
  });

  /** DELETE /api/comment/delete/own/:commentId — Any authenticated user. Soft-deletes their own comment and clears content. */
  router.delete('/comment/delete/own/:commentId', { schema: { params, response: noContent } }, async (request, reply) => {
    const userId = currentUser(request).userId;
    await requireComment(request.params.commentId, userId);
    await comments.deleteOwnComment({ ...request.params, userId });
    return reply.code(204).send(null);
  });

  /** DELETE /api/comment/delete/:commentId — Moderators only. Soft-deletes a comment and clears content. */
  router.delete('/comment/delete/:commentId', { onRequest: moderator, schema: { params, response: noContent } }, async (request, reply) => {
    await requireComment(request.params.commentId);
    await comments.deleteComment(request.params);
    return reply.code(204).send(null);
  });
};

export { commentRoutes };
