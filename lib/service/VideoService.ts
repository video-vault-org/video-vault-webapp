import { StorageWrapper } from '@/storage/StorageWrapper';
import { DatabaseAdapter } from '@/db/adapters/DatabaseAdapter';
import { Video } from '@/domain/Video';
import { logger } from '@/http/logging';

/**
 * Coordinates video metadata in the database and video files in storage.
 */
class VideoService {
  private readonly storage: StorageWrapper;
  private readonly db: DatabaseAdapter;

  /**
   * @param storage The storage wrapper used for video and thumbnail files.
   * @param db The database adapter used for video metadata and comments.
   */
  public constructor(storage: StorageWrapper, db: DatabaseAdapter) {
    this.storage = storage;
    this.db = db;
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
        logger.warn({ err: error instanceof Error ? error : new Error('Unknown temporary file cleanup error'), videoId: video.videoId }, 'Temporary video files could not be deleted');
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
   * Updates a video's video MIME type, modification date and HMAC.
   * @param videoId The ID of the video to update.
   * @param mimetype The new video MIME type.
   * @param lastModified The new modification date.
   * @param hmac The HMAC for the updated video metadata.
   * @throws If the database update fails.
   */
  public async changeVideosVideoMimetype({ videoId, mimetype, lastModified, hmac }: { videoId: string; mimetype: string; lastModified: Date; hmac: string }): Promise<void> {
    await this.db.changeVideosVideoMimetypeByVideoId({ videoId, mimetype, lastModified, hmac });
  }

  /**
   * Updates a video's thumbnail MIME type, modification date and HMAC.
   * @param videoId The ID of the video to update.
   * @param mimetype The new thumbnail MIME type.
   * @param lastModified The new modification date.
   * @param hmac The HMAC for the updated video metadata.
   * @throws If the database update fails.
   */
  public async changeVideosThumbnailMimetype({ videoId, mimetype, lastModified, hmac }: { videoId: string; mimetype: string; lastModified: Date; hmac: string }): Promise<void> {
    await this.db.changeVideosThumbnailMimetypeByVideoId({ videoId, mimetype, lastModified, hmac });
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
