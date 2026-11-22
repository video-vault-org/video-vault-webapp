import { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { AuthService } from '@/service/AuthService';
import { VideoService } from '@/service/VideoService';
import { Video } from '@/domain/Video';
import { authorization } from '../middleware';
import { HttpError } from '../errors';
import { UploadStore } from '../uploads';
import { Type, object, id, text, video, videoChange, sinceDate, metadata, errorResponses, noContent, videoInput, date } from '../validation';

/** Encodes domain timestamps explicitly for the compiled JSON response serializer. */
function publicVideo(item: Video) {
  return { ...item, recorded: item.recorded.toISOString(), lastModified: item.lastModified.toISOString() };
}

/** Registers video routes, including authenticated binary downloads and editor-only mutations. */
function videoRoutes(app: FastifyInstance, videos: VideoService, auth: AuthService, uploads: UploadStore): void {
  const router = app.withTypeProvider<TypeBoxTypeProvider>();
  const editor = authorization(auth, ['editor']);
  const params = object({ videoId: id });
  const requireVideo = async (videoId: string) => {
    const item = await videos.findVideo({ videoId });
    if (!item) throw new HttpError(404, 'Video not found');
    return item;
  };

  /** POST /api/video/upload/:videoId — Editors only. New videos require both files; existing videos accept a video, thumbnail or both. */
  router.post('/upload/:videoId', { onRequest: editor, schema: { params, response: { 201: object({ videoId: id }), ...errorResponses } } }, async (request, reply) => {
    const { videoId } = request.params;
    const existing = await videos.findVideo({ videoId });
    await uploads.receive(request, videoId, { allowPartial: existing !== null });
    return reply.code(201).send({ videoId });
  });

  /** POST /api/video/submit — Editors only. Copies staged files, saves metadata and removes temporary files. */
  router.post('/submit', { onRequest: editor, schema: { body: video, response: { 201: video, ...errorResponses } } }, async (request, reply) => {
    const item = videoInput(request.body);
    if (await videos.findVideo({ videoId: item.videoId })) throw new HttpError(409, 'Video already exists');
    await uploads.submit(item.videoId, () => videos.submitVideo(item));
    return reply.code(201).send(publicVideo(item));
  });

  /** PATCH /api/video/change/title/:videoId — Editors only. Updates title, modification time and HMAC. */
  router.patch('/change/title/:videoId', { onRequest: editor, schema: { params, body: object({ ...videoChange, title: text }), response: noContent } }, async (request, reply) => {
    await requireVideo(request.params.videoId);
    await videos.changeVideosTitle({ ...request.params, ...request.body, lastModified: new Date(request.body.lastModified) });
    return reply.code(204).send(null);
  });

  /** PATCH /api/video/change/description/:videoId — Editors only. Updates the encrypted description, modification time and HMAC. */
  router.patch('/change/description/:videoId', { onRequest: editor, schema: { params, body: object({ ...videoChange, description: Type.String({ minLength: 1, maxLength: 1_000_000 }) }), response: noContent } }, async (request, reply) => {
    await requireVideo(request.params.videoId);
    await videos.changeVideosDescription({ ...request.params, ...request.body, lastModified: new Date(request.body.lastModified) });
    return reply.code(204).send(null);
  });

  /** PATCH /api/video/change/metadata/:videoId — Editors only. Updates metadata, modification time and HMAC. */
  router.patch('/change/metadata/:videoId', { onRequest: editor, schema: { params, body: object({ ...videoChange, metadata }), response: noContent } }, async (request, reply) => {
    await requireVideo(request.params.videoId);
    await videos.changeVideosMetadata({ ...request.params, ...request.body, lastModified: new Date(request.body.lastModified) });
    return reply.code(204).send(null);
  });

  /**
   * PATCH /api/video/change/files/:videoId — Editors only. Replaces exactly the files whose MIME types are supplied.
   * Requires lastModified, hmac and at least one of videoMimeType/thumbnailMimeType. Other metadata is preserved.
   * Files must be staged through /api/video/upload/:videoId first. Failures may leave partial Storage replacements.
   */
  router.patch(
    '/change/files/:videoId',
    {
      onRequest: editor,
      schema: {
        params,
        body: { ...object({ ...videoChange, videoMimeType: Type.Optional(text), thumbnailMimeType: Type.Optional(text) }), minProperties: 3 },
        response: noContent
      }
    },
    async (request, reply) => {
      const { videoId } = request.params;
      await requireVideo(videoId);
      const files = (['video', 'thumbnail'] as const).filter((file) => request.body[`${file}MimeType`] !== undefined);
      await uploads.submit(videoId, () => videos.changeVideosFiles({ videoId, ...request.body, lastModified: new Date(request.body.lastModified) }), { files });
      return reply.code(204).send(null);
    }
  );

  /** PATCH /api/video/change/recorded/:videoId — Editors only. Updates the recording date, modification time and HMAC. */
  router.patch('/change/recorded/:videoId', { onRequest: editor, schema: { params, body: object({ ...videoChange, recorded: date }), response: noContent } }, async (request, reply) => {
    await requireVideo(request.params.videoId);
    await videos.changeVideosRecorded({ ...request.params, ...request.body, recorded: new Date(request.body.recorded), lastModified: new Date(request.body.lastModified) });
    return reply.code(204).send(null);
  });

  /** DELETE /api/video/delete/:videoId — Editors only. Deletes metadata, comments and stored files. */
  router.delete('/delete/:videoId', { onRequest: editor, schema: { params, response: noContent } }, async (request, reply) => {
    await requireVideo(request.params.videoId);
    await videos.deleteVideo(request.params);
    return reply.code(204).send(null);
  });

  /** GET /api/video/all — Editors only. Returns all video metadata. */
  router.get('/all', { onRequest: editor, schema: { response: { 200: Type.Array(video), ...errorResponses } } }, async () => (await videos.findAllVideos()).map(publicVideo));

  /** GET /api/video/find/:videoId — Editors only. Returns video metadata or 404. */
  router.get('/find/:videoId', { onRequest: editor, schema: { params, response: { 200: video, ...errorResponses } } }, async (request) => publicVideo(await requireVideo(request.params.videoId)));

  /** GET /api/video/file/:videoId?from=&to= — Any authenticated user. Encrypted bytes with inclusive bounds. */
  router.get(
    '/file/:videoId',
    {
      schema: {
        params,
        querystring: object({ from: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })), to: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })) }),
        response: { 200: Type.Unsafe<Buffer>({ type: 'string', format: 'binary' }), ...errorResponses }
      }
    },
    async (request, reply) => {
      const { videoId } = request.params;
      const { from, to } = request.query;
      if (from !== undefined && to !== undefined && from > to) throw new HttpError(416, 'Invalid byte range');
      await requireVideo(videoId);
      let bytes: Buffer | null;
      try {
        bytes = await videos.readVideoFileRange({ videoId, from, to });
      } catch (error) {
        if (error instanceof RangeError || (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 416) throw new HttpError(416, 'Invalid byte range');
        throw error;
      }
      if (!bytes) throw new HttpError(404, 'Video file not found');
      return reply.type('application/octet-stream').send(bytes);
    }
  );

  /** GET /api/video/thumbnail/:videoId — Any authenticated user. Returns encrypted thumbnail bytes. */
  router.get('/thumbnail/:videoId', { schema: { params, response: { 200: Type.Unsafe<Buffer>({ type: 'string', format: 'binary' }), ...errorResponses } } }, async (request, reply) => {
    await requireVideo(request.params.videoId);
    const bytes = await videos.readThumbnailFile(request.params);
    if (!bytes) throw new HttpError(404, 'Thumbnail not found');
    return reply.type('application/octet-stream').send(bytes);
  });

  /** GET /api/video/:since — Any authenticated user. Finds videos modified since an ISO date or Unix millisecond timestamp. */
  router.get('/:since', { schema: { params: object({ since: Type.Union([date, Type.String({ pattern: '^\\d+$', maxLength: 16 })]) }), response: { 200: Type.Array(video), ...errorResponses } } }, async (request) =>
    (await videos.findVideosLastModified({ since: sinceDate(request.params.since) })).map(publicVideo)
  );
}
export { videoRoutes };
