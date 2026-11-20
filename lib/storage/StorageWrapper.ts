import { StorageAdapter } from '@/storage/adapters/StorageAdapter';
import fs from 'fs/promises';

const VIDEO_EXTENSION = 'video';
const THUMBNAIL_EXTENSION = 'thumbnail';

const exists = async function (path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
};

class StorageWrapper {
  private readonly storageAdapter: StorageAdapter;
  private readonly temporaryDirectory: string;

  /** @param options Temporary upload directory; defaults to ./tmp. */
  public constructor(storageAdapter: StorageAdapter, { temporaryDirectory = './tmp' }: { temporaryDirectory?: string } = {}) {
    this.storageAdapter = storageAdapter;
    this.temporaryDirectory = temporaryDirectory;
  }

  /**
   * Saves the video file for a video (copies it from temporary directory into the storage)
   * @param videoId The id of the video to save the video file for
   */
  public async saveVideoFile({ videoId }: { videoId: string }): Promise<void> {
    const filename = `${videoId}.${VIDEO_EXTENSION}`;
    const tmpPath = `${this.temporaryDirectory}/${filename}`;
    if (!(await exists(tmpPath))) {
      throw new Error('tmp file does not exist');
    }
    await this.storageAdapter.save(tmpPath, filename);
  }

  /**
   * Saves the thumbnail file for a video (copies it from temporary directory into the storage)
   * @param videoId The id of the video to save the thumbnail file for
   */
  public async saveThumbnailFile({ videoId }: { videoId: string }): Promise<void> {
    const filename = `${videoId}.${THUMBNAIL_EXTENSION}`;
    const tmpPath = `${this.temporaryDirectory}/${filename}`;
    if (!(await exists(tmpPath))) {
      throw new Error('tmp file does not exist');
    }
    await this.storageAdapter.save(tmpPath, filename);
  }

  /**
   * Reads the desired range from the video file for a video
   * @param videoId The id of the video to read the video file range for
   * @param from The byte position where the range starts, if undefined it starts with first file byte
   * @param to The byte position where the range ends, if undefined it ends at last file byte
   * @returns promise with file range content as Buffer if file exists, null if not
   */
  public async readVideoFileRange({ videoId, from, to }: { videoId: string; from?: number; to?: number }): Promise<Buffer | null> {
    return await this.storageAdapter.readRange(`${videoId}.${VIDEO_EXTENSION}`, from, to);
  }

  /**
   * Reads the thumbnail file for a video
   * @param videoId The id of the video to read the thumbnail file for
   * @returns promise with file content as Buffer if file exists, null if not
   */
  public async readThumbnailFile({ videoId }: { videoId: string }): Promise<Buffer | null> {
    return await this.storageAdapter.read(`${videoId}.${THUMBNAIL_EXTENSION}`);
  }

  /**
   * Deletes both, the video file and the thumbnail file for a video
   * @param videoId The id of the video to delete the files from
   */
  public async deleteFiles({ videoId }: { videoId: string }): Promise<void> {
    await this.storageAdapter.delete(`${videoId}.${VIDEO_EXTENSION}`);
    await this.storageAdapter.delete(`${videoId}.${THUMBNAIL_EXTENSION}`);
  }
}

export { StorageWrapper };
