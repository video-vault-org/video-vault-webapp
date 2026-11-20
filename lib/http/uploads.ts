import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import multer, { StorageEngine } from 'multer';
import { Request, Response } from 'express';
import { id } from './validation';
import { HttpError } from './errors';

/** Stages bounded uploads privately and ties submission to the user who uploaded them. */
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
  public async receive(request: Request, response: Response, videoId: string, userId: string): Promise<void> {
    const reservation = this.reservation(videoId);
    await mkdir(join(this.directory, '.uploads'), { recursive: true, mode: 0o700 });
    try {
      await mkdir(reservation, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') throw new HttpError(409, 'Upload already exists');
      throw error;
    }
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
      await writeFile(join(reservation, 'owner.tmp'), JSON.stringify({ userId }), { flag: 'wx', mode: 0o600 });
      await rename(join(reservation, 'owner.tmp'), join(reservation, 'owner.json'));
    } catch (error) {
      await Promise.all([...created].map((path) => rm(path, { force: true })));
      await rm(reservation, { recursive: true, force: true });
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') throw new HttpError(409, 'Temporary file already exists');
      if ((error as Error)?.message === 'Unexpected end of form') throw new HttpError(400, 'Invalid upload');
      throw error;
    }
  }

  /** Submits an owned upload once at a time; preserves it for retry on failure and removes temporary files on success. */
  public async submit(videoId: string, userId: string, action: () => Promise<void>): Promise<void> {
    const reservation = this.reservation(videoId);
    let owner: { userId: string };
    try {
      owner = JSON.parse(await readFile(join(reservation, 'owner.json'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new HttpError(404, 'Upload not found or incomplete');
      throw error;
    }
    if (owner.userId !== userId) throw new HttpError(403, 'Upload belongs to another user');
    const busy = join(reservation, 'busy');
    try {
      await mkdir(busy);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') throw new HttpError(409, 'Upload is being submitted');
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
      await Promise.all(['video', 'thumbnail'].map((extension) => rm(join(this.directory, `${videoId}.${extension}`), { force: true })));
      await rm(reservation, { recursive: true, force: true });
    } finally {
      await rm(busy, { recursive: true, force: true });
    }
  }

  private reservation(videoId: string): string {
    return join(this.directory, '.uploads', id.parse(videoId));
  }
}

export { UploadStore };
