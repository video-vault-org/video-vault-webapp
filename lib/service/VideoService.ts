import { StorageWrapper } from '@/storage/StorageWrapper';
import { DatabaseAdapter } from '@/db/adapters/DatabaseAdapter';
import { Video } from '@/domain/Video';
import { FastifyBaseLogger } from 'fastify';

/**
 * Coordinates video metadata in the database and video files in storage.
 */
class VideoService {
  private readonly storage: StorageWrapper;
  private readonly db: DatabaseAdapter;
  private readonly logger: Pick<FastifyBaseLogger, 'warn'>;

  /**
   * @param storage The storage wrapper used for video and thumbnail files.
   * @param db The database adapter used for video metadata and comments.
   * @param logger The desired logger
   */
  public constructor(storage: StorageWrapper, db: DatabaseAdapter, { logger = console }: { logger?: Pick<FastifyBaseLogger, 'warn'> } = {}) {
    this.storage = storage;
    this.db = db;
    this.logger = logger;
  }

  /**
   * Copies the temporary video and thumbnail files into storage, then saves the video metadata.
   * Removes temporary files after saving; cleanup failures are logged as warnings and do not fail the submitting.
   * If saving fails, attempts to delete both stored files before propagating the error.
   * @param video The video metadata to save; its ID identifies both temporary files.
   * @throws If saving the files or metadata fails
   */
  public async submitVideo(video: Video): Promise<void> {
    try {
      await this.storage.saveVideoFile({ videoId: video.videoId });
      await this.storage.saveThumbnailFile({ videoId: video.videoId });
      await this.db.postVideo(video);
      await this.storage.deleteTemporaryFiles({ videoId: video.videoId }).catch((error: unknown) => {
        this.logger.warn({ err: error instanceof Error ? error : new Error('Unknown temporary file cleanup error'), videoId: video.videoId }, 'Temporary video files could not be deleted');
      });
    } catch (err: unknown) {
      await this.storage.deleteFiles({ videoId: video.videoId });
      throw err as Error;
    }
  }

  /**
   * Deletes the video metadata, then its comments, then its video and thumbnail files.
   * Stops on the first failure; earlier successful deletions are not rolled back.
   * @param videoId The ID of the video to delete.
   * @throws If a database or storage deletion fails.
   */
  public async deleteVideo({ videoId }: { videoId: string }): Promise<void> {
    await this.db.deleteVideoByVideoId({ videoId });
    await this.db.deleteCommentsByVideoId({ videoId });
    await this.storage.deleteFiles({ videoId });
  }

  /**
   * Updates a video's title, modification date and HMAC.
   * @param videoId The ID of the video to update.
   * @param title The new title.
   * @param lastModified The new modification date.
   * @param hmac The HMAC for the updated video metadata.
   * @throws If the database update fails.
   */
  public async changeVideosTitle({ videoId, title, lastModified, hmac }: { videoId: string; title: string; lastModified: Date; hmac: string }): Promise<void> {
    await this.db.changeVideosTitleByVideoId({ videoId, title, lastModified, hmac });
  }

  /**
   * Updates a video's additional metadata, modification date and HMAC.
   * @param videoId The ID of the video to update.
   * @param metadata The new additional metadata.
   * @param lastModified The new modification date.
   * @param hmac The HMAC for the updated video metadata.
   * @throws If the database update fails.
   */
  public async changeVideosMetadata({ videoId, metadata, lastModified, hmac }: { videoId: string; metadata: Record<string, unknown>; lastModified: Date; hmac: string }): Promise<void> {
    await this.db.changeVideosMetadataByVideoId({ videoId, metadata, lastModified, hmac });
  }

  /**
   * Replaces the staged video, thumbnail or both, then atomically updates their MIME types, lastModified and hmac.
   * Only files with a supplied MIME type are copied and cleaned up. Other files and metadata are preserved.
   * Storage writes are not rolled back: on failure, partial file replacements are possible and temporary files remain for retry.
   * Cleanup failures after a successful replacement are logged without failing the operation.
   * @throws If no MIME type is supplied, a staged file is missing, copying fails or the database update fails.
   */
  public async changeVideosFiles({ videoId, videoMimeType, thumbnailMimeType, lastModified, hmac }: { videoId: string; videoMimeType?: string; thumbnailMimeType?: string; lastModified: Date; hmac: string }): Promise<void> {
    const files: ('video' | 'thumbnail')[] = [];
    if (videoMimeType !== undefined) files.push('video');
    if (thumbnailMimeType !== undefined) files.push('thumbnail');
    if (files.length === 0) throw new RangeError('At least one file MIME type is required');
    if (videoMimeType !== undefined) await this.storage.saveVideoFile({ videoId });
    if (thumbnailMimeType !== undefined) await this.storage.saveThumbnailFile({ videoId });
    await this.db.changeVideosFileAttributesByVideoId({ videoId, videoMimeType, thumbnailMimeType, lastModified, hmac });
    await this.storage.deleteTemporaryFiles({ videoId, files }).catch((error: unknown) => {
      this.logger.warn({ err: error instanceof Error ? error : new Error('Unknown temporary file cleanup error'), videoId }, 'Temporary video files could not be deleted');
    });
  }

  /**
   * Finds a video by its ID.
   * @param videoId The ID of the video to find.
   * @returns The video metadata, or null if no matching video exists.
   * @throws If the database query fails.
   */
  public async findVideo({ videoId }: { videoId: string }): Promise<Video | null> {
    return await this.db.findOneVideoByVideoId({ videoId });
  }

  /**
   * Finds videos modified on or after the given date.
   * @param since The earliest modification date to include, inclusive.
   * @returns The matching video metadata, or an empty array if none match.
   * @throws If the database query fails.
   */
  public async findVideosLastModified({ since }: { since: Date }): Promise<Video[]> {
    return await this.db.findManyVideosLastModified({ since });
  }

  /**
   * Finds all videos without sorting or pagination.
   * @returns All video metadata, or an empty array if no videos exist.
   * @throws If the database query fails.
   */
  public async findAllVideos(): Promise<Video[]> {
    return await this.db.findAllVideos();
  }

  /**
   * Reads a byte range from a video's stored video file.
   * @param videoId The ID of the video to read.
   * @param from The first byte offset, inclusive; defaults to the start of the file.
   * @param to The last byte offset, inclusive; defaults to the end of the file.
   * @returns The requested bytes, or null if the video file does not exist.
   * @throws If the range is invalid or the storage read fails.
   */
  public async readVideoFileRange({ videoId, from, to }: { videoId: string; from?: number; to?: number }): Promise<Buffer | null> {
    return await this.storage.readVideoFileRange({ videoId, from, to });
  }

  /**
   * Reads a video's complete stored thumbnail file.
   * @param videoId The ID of the video whose thumbnail to read.
   * @returns The thumbnail bytes, or null if the thumbnail file does not exist.
   * @throws If the storage read fails.
   */
  public async readThumbnailFile({ videoId }: { videoId: string }): Promise<Buffer | null> {
    return await this.storage.readThumbnailFile({ videoId });
  }
}

export { VideoService };
