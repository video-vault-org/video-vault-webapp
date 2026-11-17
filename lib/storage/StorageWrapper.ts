import { StorageAdapter } from '@/storage/adapters/StorageAdapter';

const VIDEO_EXTENSION = 'video';
const THUMBNAIL_EXTENSION = 'thumbnail';

class StorageWrapper {
  private readonly storageAdapter: StorageAdapter;

  public constructor(storageAdapter: StorageAdapter) {
    this.storageAdapter = storageAdapter;
  }

  /**
   * Saves the video file for a video
   * @param videoId The id of the video to save the video file for
   * @param data The encrypted binary video data
   */
  public async saveVideoFile(videoId: string, data: Buffer): Promise<void> {
    await this.storageAdapter.save(`${videoId}.${VIDEO_EXTENSION}`, data);
  }

  /**
   * Saves the thumbnail file for a video
   * @param videoId The id of the video to save the thumbnail file for
   * @param data The encrypted binary thumbnail data
   */
  public async saveThumbnailFile(videoId: string, data: Buffer): Promise<void> {
    await this.storageAdapter.save(`${videoId}.${THUMBNAIL_EXTENSION}`, data);
  }

  /**
   * Reads the desired range from the video file for a video
   * @param videoId The id of the video to read the video file range for
   * @param from The byte position where the range starts, if undefined it starts with first file byte
   * @param to The byte position where the range ends, if undefined it ends at last file byte
   * @returns promise with file range content as Buffer if file exists, null if not
   */
  public async readVideoFileRange(videoId: string, from?: number, to?: number): Promise<Buffer | null> {
    return await this.storageAdapter.readRange(`${videoId}.${VIDEO_EXTENSION}`, from, to);
  }

  /**
   * Reads the thumbnail file for a video
   * @param videoId The id of the video to read the thumbnail file for
   * @returns promise with file content as Buffer if file exists, null if not
   */
  public async readThumbnailFile(videoId: string): Promise<Buffer | null> {
    return await this.storageAdapter.read(`${videoId}.${THUMBNAIL_EXTENSION}`);
  }

  /**
   * Deletes both, the video file and the thumbnail file for a video
   * @param videoId The id of the video to delete the files from
   */
  public async deleteFiles(videoId: string): Promise<void> {
    await this.storageAdapter.delete(`${videoId}.${VIDEO_EXTENSION}`);
    await this.storageAdapter.delete(`${videoId}.${THUMBNAIL_EXTENSION}`);
  }
}

export { StorageWrapper };
