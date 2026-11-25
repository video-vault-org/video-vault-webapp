import { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { AuthService } from '@/service/AuthService';
import { VideoService } from '@/service/VideoService';
import { Video } from '@/domain/Video';
import { authorization } from '../middleware';
import { HttpError } from '../errors';
import { parseByteRange } from '../byteRange';
import { UploadStore, UPLOAD_PART_BYTES } from '../uploads';
import { Type, object, id, text, video, videoRecord, videoChange, sinceDate, metadata, errorResponses, noContent, videoInput, date } from '../validation';

/** Encodes domain timestamps explicitly for the compiled JSON response serializer. */
const publicVideo = function (item: Video) {
  return { ...item, recorded: item.recorded.toISOString(), lastModified: item.lastModified.toISOString() };
};

/** Registers video routes, including authenticated binary downloads and editor-only mutations. */
const videoRoutes = function (app: FastifyInstance, videos: VideoService, auth: AuthService, uploads: UploadStore): void {
  const router = app.withTypeProvider<TypeBoxTypeProvider>();
  const editor = authorization(auth, ['editor']);
  const params = object({ videoId: id });
  const sessionParams = object({ videoId: id, uploadId: Type.String({ format: 'uuid' }) });
  const kind = Type.Union([Type.Literal('video'), Type.Literal('thumbnail')]);

  router.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: UPLOAD_PART_BYTES }, (_request, body, done) => done(null, body));

  const requireVideo = async (videoId: string) => {
    const item = await videos.findVideo({ videoId });
    if (!item || item.deleted) throw new HttpError(404, 'Video not found');
    return item;
  };

  /** POST /api/video/upload/:videoId — Editors only. New videos require both files; existing videos accept a video, thumbnail or both. */
  router.post('/upload/:videoId', { onRequest: editor, schema: { params, response: { 201: object({ videoId: id }), ...errorResponses } } }, async (request, reply) => {
    const { videoId } = request.params;
    const existing = await videos.findVideo({ videoId });
    if (existing?.deleted) throw new HttpError(409, 'Video ID belongs to a deleted video');
    await uploads.receive(request, videoId, { allowPartial: existing !== null });
    return reply.code(201).send({ videoId });
  });

  /** POST /api/video/upload/:videoId/start — Editors only. Checks encrypted sizes and reserves a packet upload before encryption starts. */
  router.post(
    '/upload/:videoId/start',
    {
      onRequest: editor,
      schema: {
        params,
        body: object({ files: Type.Array(object({ kind, size: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }) }), { minItems: 1, maxItems: 2 }) }),
        response: { 201: object({ uploadId: Type.String({ format: 'uuid' }), maxPartBytes: Type.Integer() }), ...errorResponses }
      }
    },
    async (request, reply) => {
      const existing = await videos.findVideo(request.params);
      if (existing?.deleted) throw new HttpError(409, 'Video ID belongs to a deleted video');
      const uploadId = await uploads.start(request.params.videoId, request.body.files, { allowPartial: existing !== null });
      return reply.code(201).send({ uploadId, maxPartBytes: UPLOAD_PART_BYTES });
    }
  );

  /** PUT /api/video/upload/:videoId/:uploadId/:kind?offset=N — Editors only. Stores at most 4 MiB of encrypted bytes; matching retries are idempotent. */
  router.put(
    '/upload/:videoId/:uploadId/:kind',
    {
      onRequest: editor,
      bodyLimit: UPLOAD_PART_BYTES,
      schema: {
        params: object({ ...sessionParams.properties, kind }),
        querystring: object({ offset: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) }),
        body: Type.Unsafe<Buffer>({}),
        response: { 200: object({ received: Type.Integer({ minimum: 1 }) }), ...errorResponses }
      }
    },
    async (request) => {
      const { videoId, uploadId, kind } = request.params;
      return { received: await uploads.append(videoId, uploadId, kind, request.query.offset, request.body) };
    }
  );

  /** POST /api/video/upload/:videoId/:uploadId/complete — Editors only. Publishes complete files for a later new-video or replacement submit. */
  router.post('/upload/:videoId/:uploadId/complete', { onRequest: editor, schema: { params: sessionParams, response: noContent } }, async (request, reply) => {
    const { videoId, uploadId } = request.params;
    if ((await videos.findVideo({ videoId }))?.deleted) throw new HttpError(409, 'Video ID belongs to a deleted video');
    await uploads.complete(videoId, uploadId);
    return reply.code(204).send(null);
  });

  /** DELETE /api/video/upload/:videoId/:uploadId — Editors only. Removes partial upload data/session metadata, preserving completed staging files. */
  router.delete('/upload/:videoId/:uploadId', { onRequest: editor, schema: { params: sessionParams, response: noContent } }, async (request, reply) => {
    await uploads.cancel(request.params.videoId, request.params.uploadId);
    return reply.code(204).send(null);
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

  /** DELETE /api/video/delete/:videoId — Editors only. Persists a permanent tombstone with JSON { lastModified }, then removes comments and files. Repeated deletes retry cleanup without changing the original tombstone. */
  router.delete('/delete/:videoId', { onRequest: editor, schema: { params, body: object({ lastModified: date }), response: noContent } }, async (request, reply) => {
    if (!(await videos.findVideo(request.params))) throw new HttpError(404, 'Video not found');
    await videos.deleteVideo({ ...request.params, lastModified: new Date(request.body.lastModified) });
    return reply.code(204).send(null);
  });

  /** HEAD /api/video/file/:videoId — Any authenticated user. Encrypted size for authenticated chunk-range playback. */
  router.head('/file/:videoId', { config: { swagger: { exposeHeadRoute: true } }, schema: { params, response: { 200: Type.Null(), ...errorResponses } } }, async (request, reply) => {
    await requireVideo(request.params.videoId);
    const size = await videos.videoFileSize(request.params);
    if (size === null) throw new HttpError(404, 'Video file not found');
    return reply.header('Content-Length', size).header('Accept-Ranges', 'bytes').type('application/octet-stream').send(null);
  });

  /** GET /api/video/all — Editors only. Returns all video metadata. */
  router.get('/all', { onRequest: editor, schema: { response: { 200: Type.Array(video), ...errorResponses } } }, async () => (await videos.findAllVideos()).map(publicVideo));

  /** GET /api/video/find/:videoId — Editors only. Returns video metadata or 404. */
  router.get('/find/:videoId', { onRequest: editor, schema: { params, response: { 200: video, ...errorResponses } } }, async (request) => publicVideo(await requireVideo(request.params.videoId)));

  /** GET /api/video/file/:videoId?from=&to= — Any authenticated user. Encrypted bytes with inclusive query bounds or one HTTP Range header (206). */
  router.get(
    '/file/:videoId',
    {
      exposeHeadRoute: false,
      schema: {
        params,
        querystring: object({ from: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })), to: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })) }),
        response: { 200: Type.Unsafe<Buffer>({ type: 'string', format: 'binary' }), 206: Type.Unsafe<Buffer>({ type: 'string', format: 'binary' }), ...errorResponses }
      }
    },
    async (request, reply) => {
      const { videoId } = request.params;
      let { from, to } = request.query;
      if (from !== undefined && to !== undefined && from > to) throw new HttpError(416, 'Invalid byte range');
      await requireVideo(videoId);
      if (request.headers.range !== undefined) {
        if (from !== undefined || to !== undefined) throw new HttpError(400, 'Use Range or query bounds, not both');
        const size = await videos.videoFileSize({ videoId });
        if (size === null) throw new HttpError(404, 'Video file not found');
        try {
          [from, to] = parseByteRange(request.headers.range, size);
        } catch {
          reply.header('Content-Range', `bytes */${size}`);
          throw new HttpError(416, 'Invalid byte range');
        }
        reply.code(206).header('Content-Range', `bytes ${from}-${to}/${size}`).header('Accept-Ranges', 'bytes');
      }
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

  /** GET /api/video/:since — Any authenticated user. Finds video changes including unverified deletion tombstones, since an ISO date or Unix millisecond timestamp. */
  router.get('/:since', { schema: { params: object({ since: Type.Union([date, Type.String({ pattern: '^\\d+$', maxLength: 16 })]) }), response: { 200: Type.Array(videoRecord), ...errorResponses } } }, async (request) =>
    (await videos.findVideosLastModified({ since: sinceDate(request.params.since) })).map(publicVideo)
  );
};

export { videoRoutes };
