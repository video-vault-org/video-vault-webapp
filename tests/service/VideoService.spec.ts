import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { Video } from '@/domain/Video';
import { VideoService } from '@/service/VideoService';
import { StorageWrapper } from '@/storage/StorageWrapper';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';

describe('VideoService', () => {
  const video: Video = {
    videoId: 'v1',
    title: 'Original title',
    meta: { duration: 10 },
    videoMimeType: 'video/mp4',
    thumbnailMimeType: 'image/png',
    lastModified: new Date(100),
    hmac: 'original-hmac'
  };
  const videoId = video.videoId;
  const lastModified = new Date(200);
  const hmac = 'updated-hmac';
  let storage: StorageWrapper;
  let db: InMemoryDatabaseAdapter;
  let service: VideoService;

  beforeEach(() => {
    storage = new StorageWrapper(new InMemoryStorageAdapter());
    db = new InMemoryDatabaseAdapter();
    service = new VideoService(storage, db);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('submitVideo', () => {
    test('saves both files before posting the video metadata', async () => {
      const saveVideo = jest.spyOn(storage, 'saveVideoFile').mockResolvedValue(undefined);
      const saveThumbnail = jest.spyOn(storage, 'saveThumbnailFile').mockResolvedValue(undefined);
      const postVideo = jest.spyOn(db, 'postVideo').mockResolvedValue(undefined);
      const cleanup = jest.spyOn(storage, 'deleteFiles').mockResolvedValue(undefined);

      await expect(service.submitVideo(video)).resolves.toBeUndefined();

      expect(saveVideo).toHaveBeenCalledTimes(1);
      expect(saveVideo).toHaveBeenCalledWith({ videoId });
      expect(saveThumbnail).toHaveBeenCalledTimes(1);
      expect(saveThumbnail).toHaveBeenCalledWith({ videoId });
      expect(postVideo).toHaveBeenCalledTimes(1);
      expect(postVideo).toHaveBeenCalledWith(video);
      expect(saveVideo.mock.invocationCallOrder[0]).toBeLessThan(saveThumbnail.mock.invocationCallOrder[0]);
      expect(saveThumbnail.mock.invocationCallOrder[0]).toBeLessThan(postVideo.mock.invocationCallOrder[0]);
      expect(cleanup).not.toHaveBeenCalled();
    });

    test.each(['video', 'thumbnail', 'metadata'] as const)('cleans up stored files and propagates a failure saving %s', async (step) => {
      const error = new Error(`Cannot save ${step}`);
      const saveVideo = jest.spyOn(storage, 'saveVideoFile').mockResolvedValue(undefined);
      const saveThumbnail = jest.spyOn(storage, 'saveThumbnailFile').mockResolvedValue(undefined);
      const postVideo = jest.spyOn(db, 'postVideo').mockResolvedValue(undefined);
      const cleanup = jest.spyOn(storage, 'deleteFiles').mockResolvedValue(undefined);
      const failingOperation = { video: saveVideo, thumbnail: saveThumbnail, metadata: postVideo }[step];
      failingOperation.mockRejectedValueOnce(error);

      await expect(service.submitVideo(video)).rejects.toBe(error);

      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledWith({ videoId });
      expect(failingOperation.mock.invocationCallOrder[0]).toBeLessThan(cleanup.mock.invocationCallOrder[0]);
      if (step === 'video') {
        expect(saveThumbnail).not.toHaveBeenCalled();
      }
      if (step !== 'metadata') {
        expect(postVideo).not.toHaveBeenCalled();
      }
    });

    test('propagates a cleanup failure if deleting files after a failed submit also fails', async () => {
      const submitError = new Error('Cannot save video');
      const cleanupError = new Error('Cannot delete files');
      jest.spyOn(storage, 'saveVideoFile').mockRejectedValueOnce(submitError);
      jest.spyOn(storage, 'deleteFiles').mockRejectedValueOnce(cleanupError);
      const postVideo = jest.spyOn(db, 'postVideo');

      await expect(service.submitVideo(video)).rejects.toBe(cleanupError);

      expect(postVideo).not.toHaveBeenCalled();
    });
  });

  describe('deleteVideo', () => {
    test('deletes the video metadata, comments and stored files in order', async () => {
      const deleteVideo = jest.spyOn(db, 'deleteVideoByVideoId').mockResolvedValue(undefined);
      const deleteComments = jest.spyOn(db, 'deleteCommentsByVideoId').mockResolvedValue(undefined);
      const deleteFiles = jest.spyOn(storage, 'deleteFiles').mockResolvedValue(undefined);

      await expect(service.deleteVideo({ videoId })).resolves.toBeUndefined();

      for (const operation of [deleteVideo, deleteComments, deleteFiles]) {
        expect(operation).toHaveBeenCalledTimes(1);
        expect(operation).toHaveBeenCalledWith({ videoId });
      }
      expect(deleteVideo.mock.invocationCallOrder[0]).toBeLessThan(deleteComments.mock.invocationCallOrder[0]);
      expect(deleteComments.mock.invocationCallOrder[0]).toBeLessThan(deleteFiles.mock.invocationCallOrder[0]);
    });

    test.each(['metadata', 'comments', 'files'] as const)('propagates a failure deleting %s and stops subsequent operations', async (step) => {
      const error = new Error(`Cannot delete ${step}`);
      const deleteVideo = jest.spyOn(db, 'deleteVideoByVideoId').mockResolvedValue(undefined);
      const deleteComments = jest.spyOn(db, 'deleteCommentsByVideoId').mockResolvedValue(undefined);
      const deleteFiles = jest.spyOn(storage, 'deleteFiles').mockResolvedValue(undefined);
      const failingOperation = { metadata: deleteVideo, comments: deleteComments, files: deleteFiles }[step];
      failingOperation.mockRejectedValueOnce(error);

      await expect(service.deleteVideo({ videoId })).rejects.toBe(error);

      expect(failingOperation).toHaveBeenCalledWith({ videoId });
      if (step === 'metadata') {
        expect(deleteComments).not.toHaveBeenCalled();
      }
      if (step !== 'files') {
        expect(deleteFiles).not.toHaveBeenCalled();
      }
    });
  });

  test('changeVideosTitle forwards the title, modification date and HMAC', async () => {
    const update = jest.spyOn(db, 'changeVideosTitleByVideoId').mockResolvedValue(undefined);
    const parameters = { videoId, title: 'New title', lastModified, hmac };

    await expect(service.changeVideosTitle(parameters)).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(parameters);
  });

  test('changeVideosMetadata forwards additional metadata, modification date and HMAC', async () => {
    const update = jest.spyOn(db, 'changeVideosMetadataByVideoId').mockResolvedValue(undefined);
    const parameters = { videoId, metadata: { duration: 20, custom: { encrypted: true } }, lastModified, hmac };

    await expect(service.changeVideosMetadata(parameters)).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(parameters);
  });

  test('changeVideosVideoMimetype forwards the video MIME type, modification date and HMAC', async () => {
    const update = jest.spyOn(db, 'changeVideosVideoMimetypeByVideoId').mockResolvedValue(undefined);
    const parameters = { videoId, mimetype: 'video/webm', lastModified, hmac };

    await expect(service.changeVideosVideoMimetype(parameters)).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(parameters);
  });

  test('changeVideosThumbnailMimetype forwards the thumbnail MIME type, modification date and HMAC', async () => {
    const update = jest.spyOn(db, 'changeVideosThumbnailMimetypeByVideoId').mockResolvedValue(undefined);
    const parameters = { videoId, mimetype: 'image/webp', lastModified, hmac };

    await expect(service.changeVideosThumbnailMimetype(parameters)).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(parameters);
  });

  test.each([
    ['changeVideosTitle', 'changeVideosTitleByVideoId'],
    ['changeVideosMetadata', 'changeVideosMetadataByVideoId'],
    ['changeVideosVideoMimetype', 'changeVideosVideoMimetypeByVideoId'],
    ['changeVideosThumbnailMimetype', 'changeVideosThumbnailMimetypeByVideoId']
  ] as const)('%s propagates database errors', async (method, dbMethod) => {
    const error = new Error('Database unavailable');
    jest.spyOn(db, dbMethod).mockRejectedValueOnce(error);
    const parameters = { videoId, title: 'New title', metadata: {}, mimetype: 'application/octet-stream', lastModified, hmac };

    await expect(service[method](parameters)).rejects.toBe(error);
  });

  describe('findVideo', () => {
    test.each([video, null])('returns the database result %j', async (result) => {
      const find = jest.spyOn(db, 'findOneVideoByVideoId').mockResolvedValueOnce(result);

      await expect(service.findVideo({ videoId })).resolves.toBe(result);

      expect(find).toHaveBeenCalledTimes(1);
      expect(find).toHaveBeenCalledWith({ videoId });
    });

    test('propagates database errors', async () => {
      const error = new Error('Database unavailable');
      jest.spyOn(db, 'findOneVideoByVideoId').mockRejectedValueOnce(error);

      await expect(service.findVideo({ videoId })).rejects.toBe(error);
    });
  });

  describe('findVideosLastModified', () => {
    test.each([[[]], [[video]]])('returns matching videos %j and forwards the date', async (result) => {
      const since = new Date(100);
      const find = jest.spyOn(db, 'findManyVideosLastModified').mockResolvedValueOnce(result);

      await expect(service.findVideosLastModified({ since })).resolves.toBe(result);

      expect(find).toHaveBeenCalledTimes(1);
      expect(find).toHaveBeenCalledWith({ since });
    });

    test('propagates database errors', async () => {
      const error = new Error('Database unavailable');
      jest.spyOn(db, 'findManyVideosLastModified').mockRejectedValueOnce(error);

      await expect(service.findVideosLastModified({ since: new Date(100) })).rejects.toBe(error);
    });
  });

  describe('findAllVideos', () => {
    test.each([[[]], [[video, { ...video, videoId: 'v2' }]]])('returns all videos %j', async (result) => {
      const find = jest.spyOn(db, 'findAllVideos').mockResolvedValueOnce(result);

      await expect(service.findAllVideos()).resolves.toBe(result);

      expect(find).toHaveBeenCalledTimes(1);
      expect(find).toHaveBeenCalledWith();
    });

    test('propagates database errors', async () => {
      const error = new Error('Database unavailable');
      jest.spyOn(db, 'findAllVideos').mockRejectedValueOnce(error);

      await expect(service.findAllVideos()).rejects.toBe(error);
    });
  });

  describe('readVideoFileRange', () => {
    test.each([
      [0, 0],
      [1, 3],
      [2, undefined],
      [undefined, 0],
      [undefined, undefined]
    ])('forwards inclusive bounds from %s to %s and returns the bytes unchanged', async (from, to) => {
      const result = Buffer.from([0, 128, 255]);
      const read = jest.spyOn(storage, 'readVideoFileRange').mockResolvedValueOnce(result);

      await expect(service.readVideoFileRange({ videoId, from, to })).resolves.toBe(result);

      expect(read).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith({ videoId, from, to });
    });

    test('allows both bounds to be omitted and returns null for a missing file', async () => {
      const read = jest.spyOn(storage, 'readVideoFileRange').mockResolvedValueOnce(null);

      await expect(service.readVideoFileRange({ videoId })).resolves.toBeNull();

      expect(read).toHaveBeenCalledWith({ videoId, from: undefined, to: undefined });
    });

    test.each([
      { name: 'invalid byte range', error: new RangeError('Invalid byte range') },
      { name: 'storage failure', error: new Error('Storage unavailable') }
    ])('propagates $name', async ({ error }) => {
      jest.spyOn(storage, 'readVideoFileRange').mockRejectedValueOnce(error);

      await expect(service.readVideoFileRange({ videoId, from: 3, to: 1 })).rejects.toBe(error);
    });
  });

  describe('readThumbnailFile', () => {
    test.each([
      ['binary thumbnail', Buffer.from([0, 128, 255])],
      ['empty thumbnail', Buffer.alloc(0)],
      ['missing thumbnail', null]
    ] as const)('returns the %s result unchanged', async (_label, result) => {
      const read = jest.spyOn(storage, 'readThumbnailFile').mockResolvedValueOnce(result);

      await expect(service.readThumbnailFile({ videoId })).resolves.toBe(result);

      expect(read).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith({ videoId });
    });

    test('propagates storage errors', async () => {
      const error = new Error('Storage unavailable');
      jest.spyOn(storage, 'readThumbnailFile').mockRejectedValueOnce(error);

      await expect(service.readThumbnailFile({ videoId })).rejects.toBe(error);
    });
  });
});
