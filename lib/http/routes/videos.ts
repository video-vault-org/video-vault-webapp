import { Router } from 'express';
import { z } from 'zod';
import { AuthService } from '@/service/AuthService';
import { VideoService } from '@/service/VideoService';
import { authorization, currentUser } from '../middleware';
import { HttpError } from '../errors';
import { UploadStore } from '../uploads';
import { id, text, video, videoChange, sinceDate } from '../validation';

/** Builds video routes; the parent router must authenticate every request first. */
function videoRoutes(videos: VideoService, auth: AuthService, uploads: UploadStore): Router {
  const router = Router();
  const editor = authorization(auth, ['editor']);
  const requireVideo = async (videoId: string) => {
    const item = await videos.findVideo({ videoId });
    if (!item) throw new HttpError(404, 'Video not found');
    return item;
  };

  /** POST /api/video/upload/:videoId — Editors only. Multipart fields: video and thumbnail. Files are staged for their uploader. */
  router.post('/upload/:videoId', editor, async (request, response) => {
    const videoId = id.parse(request.params.videoId);
    if (await videos.findVideo({ videoId })) throw new HttpError(409, 'Video already exists');
    await uploads.receive(request, response, videoId, currentUser(response).userId);
    response.status(201).json({ videoId });
  });

  /** POST /api/video/submit — Editors only. JSON Video metadata; requires this user's completed upload with the same videoId. */
  router.post('/submit', editor, async (request, response) => {
    const item = video.parse(request.body);
    if (await videos.findVideo({ videoId: item.videoId })) throw new HttpError(409, 'Video already exists');
    await uploads.submit(item.videoId, currentUser(response).userId, () => videos.submitVideo(item));
    response.status(201).json(item);
  });

  /** PATCH /api/video/change/title/:videoId — Editors only. JSON body: title, lastModified (ISO date), hmac. */
  router.patch('/change/title/:videoId', editor, async (request, response) => {
    const videoId = id.parse(request.params.videoId);
    const change = videoChange.extend({ title: text }).strict().parse(request.body);
    await requireVideo(videoId);
    await videos.changeVideosTitle({ videoId, ...change });
    response.sendStatus(204);
  });

  /** PATCH /api/video/change/metadata/:videoId — Editors only. JSON body: metadata, lastModified, hmac. */
  router.patch('/change/metadata/:videoId', editor, async (request, response) => {
    const videoId = id.parse(request.params.videoId);
    const change = videoChange
      .extend({ metadata: z.record(z.string(), z.unknown()) })
      .strict()
      .parse(request.body);
    await requireVideo(videoId);
    await videos.changeVideosMetadata({ videoId, ...change });
    response.sendStatus(204);
  });

  /** PATCH /api/video/change/video-mimetype/:videoId — Editors only. JSON body: mimetype, lastModified, hmac. */
  router.patch('/change/video-mimetype/:videoId', editor, async (request, response) => {
    const videoId = id.parse(request.params.videoId);
    const change = videoChange.extend({ mimetype: text }).strict().parse(request.body);
    await requireVideo(videoId);
    await videos.changeVideosVideoMimetype({ videoId, ...change });
    response.sendStatus(204);
  });

  /** PATCH /api/video/change/thumbnail-mimetype/:videoId — Editors only. JSON body: mimetype, lastModified, hmac. */
  router.patch('/change/thumbnail-mimetype/:videoId', editor, async (request, response) => {
    const videoId = id.parse(request.params.videoId);
    const change = videoChange.extend({ mimetype: text }).strict().parse(request.body);
    await requireVideo(videoId);
    await videos.changeVideosThumbnailMimetype({ videoId, ...change });
    response.sendStatus(204);
  });

  /** DELETE /api/video/delete/:videoId — Editors only. Deletes metadata, comments and both stored files. */
  router.delete('/delete/:videoId', editor, async (request, response) => {
    const videoId = id.parse(request.params.videoId);
    await requireVideo(videoId);
    await videos.deleteVideo({ videoId });
    response.sendStatus(204);
  });

  /** GET /api/video/all — Editors only. Returns all video metadata. */
  router.get('/all', editor, async (_request, response) => {
    response.json(await videos.findAllVideos());
  });

  /** GET /api/video/find/:videoId — Editors only. Returns one video's metadata, or 404. */
  router.get('/find/:videoId', editor, async (request, response) => {
    response.json(await requireVideo(id.parse(request.params.videoId)));
  });

  /** GET /api/video/file/:videoId?from=&to= — Any authenticated user. Returns encrypted video bytes; optional bounds are inclusive. */
  router.get('/file/:videoId', async (request, response) => {
    const videoId = id.parse(request.params.videoId);
    const bound = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional();
    const { from, to } = z.object({ from: bound, to: bound }).strict().parse(request.query);
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
    response.type('application/octet-stream').send(bytes);
  });

  /** GET /api/video/thumbnail/:videoId — Any authenticated user. Returns the encrypted thumbnail bytes, or 404. */
  router.get('/thumbnail/:videoId', async (request, response) => {
    const videoId = id.parse(request.params.videoId);
    await requireVideo(videoId);
    const bytes = await videos.readThumbnailFile({ videoId });
    if (!bytes) throw new HttpError(404, 'Thumbnail not found');
    response.type('application/octet-stream').send(bytes);
  });

  /** GET /api/video/:since — Any authenticated user. Videos modified on or after an ISO date or Unix millisecond timestamp. */
  router.get('/:since', async (request, response) => {
    response.json(await videos.findVideosLastModified({ since: sinceDate(request.params.since) }));
  });
  return router;
}

export { videoRoutes };
