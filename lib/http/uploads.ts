import { createWriteStream } from 'node:fs';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import multer, { StorageEngine } from 'multer';
import { Request, Response } from 'express';
import { id } from './validation';
import { HttpError } from './errors';

/** Stages bounded video and thumbnail uploads and prevents concurrent submits for the same video. */
class UploadStore {
  private readonly directory: string;
  private readonly maxVideoBytes: number;
  private readonly maxThumbnailBytes: number;

  public constructor({ directory = './tmp', maxVideoBytes = 2 * 1024 ** 3, maxThumbnailBytes = 20 * 1024 ** 2 }: { directory?: string; maxVideoBytes?: number; maxThumbnailBytes?: number } = {}) {
    for (const limit of [maxVideoBytes, maxThumbnailBytes]) {
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError('Upload limits must be positive safe integers');
    }
    this.directory = resolve(directory);
    this.maxVideoBytes = maxVideoBytes;
    this.maxThumbnailBytes = maxThumbnailBytes;
  }

  /** Receives exactly one video and one thumbnail, streaming to disk and enforcing each file's size limit. */
  public async receive(request: Request, response: Response, videoId: string): Promise<void> {
    id.parse(videoId);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });

    const created = new Set<string>();

    const storage: StorageEngine = {
      _handleFile: (_request, file, callback) => {
        const path = join(this.directory, `${videoId}.${file.fieldname}`);
        const maximum = file.fieldname === 'video' ? this.maxVideoBytes : this.maxThumbnailBytes;
        let size = 0;
        const output = createWriteStream(path, { flags: 'wx', mode: 0o600 });
        output.on('open', () => created.add(path));
        const limit = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            size += chunk.length;
            done(size > maximum ? new HttpError(413, 'Upload too large') : null, chunk);
          }
        });
        pipeline(file.stream, limit, output).then(
          () => callback(null, { path, size, filename: `${videoId}.${file.fieldname}`, destination: this.directory }),
          (error: Error) => callback(error)
        );
      },
      _removeFile: (_request, file, callback) => {
        if (!created.has(file.path)) return callback(null);
        rm(file.path, { force: true }).then(() => callback(null), callback);
      }
    };

    try {
      const upload = multer({ storage, limits: { files: 2, fields: 0, parts: 2, fileSize: Math.max(this.maxVideoBytes, this.maxThumbnailBytes) } }).fields([
        { name: 'video', maxCount: 1 },
        { name: 'thumbnail', maxCount: 1 }
      ]);
      await new Promise<void>((done, reject) => upload(request, response, (error?: unknown) => (error ? reject(error) : done())));
      const files = request.files as Record<string, Express.Multer.File[]> | undefined;
      if (files?.video?.length !== 1 || files?.thumbnail?.length !== 1) throw new HttpError(400, 'Video and thumbnail are required');
    } catch (error) {
      await Promise.all([...created].map((path) => rm(path, { force: true })));
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') throw new HttpError(409, 'Temporary file already exists');
      if ((error as Error)?.message === 'Unexpected end of form') throw new HttpError(400, 'Invalid upload');
      throw error;
    }
  }

  /** Submits staged files once at a time using an exclusive .<videoId>.busy file in the temporary directory. */
  public async submit(videoId: string, action: () => Promise<void>): Promise<void> {
    const busy = join(this.directory, `.${id.parse(videoId)}.busy`);
    try {
      await writeFile(busy, '', { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') throw new HttpError(409, 'Upload is being submitted');
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new HttpError(404, 'Upload files not found');
      throw error;
    }

    try {
      try {
        await access(join(this.directory, `${videoId}.video`));
        await access(join(this.directory, `${videoId}.thumbnail`));
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new HttpError(404, 'Upload files not found');
        throw error;
      }
      await action();
    } finally {
      await rm(busy, { force: true });
    }
  }
}

export { UploadStore };
