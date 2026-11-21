import { createWriteStream } from 'node:fs';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FastifyRequest } from 'fastify';
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

  /** Receives exactly one video and one thumbnail via Fastify's multipart streams, enforcing individual size limits. */
  public async receive(request: FastifyRequest, videoId: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(videoId)) throw new HttpError(400, 'Invalid video ID');
    if (!request.isMultipart()) throw new HttpError(400, 'Video and thumbnail are required');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const created = new Set<string>();
    const received = new Set<string>();

    try {
      for await (const part of request.parts({ limits: { files: 2, fields: 0, parts: 2, fileSize: Math.max(this.maxVideoBytes, this.maxThumbnailBytes) } })) {
        if (part.type !== 'file' || !['video', 'thumbnail'].includes(part.fieldname) || received.has(part.fieldname)) {
          if (part.type === 'file') part.file.resume();
          throw new HttpError(400, 'Video and thumbnail are required');
        }
        received.add(part.fieldname);
        const path = join(this.directory, `${videoId}.${part.fieldname}`);
        const maximum = part.fieldname === 'video' ? this.maxVideoBytes : this.maxThumbnailBytes;
        let size = 0;
        const output = createWriteStream(path, { flags: 'wx', mode: 0o600 });
        output.on('open', () => created.add(path));
        const limit = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            size += chunk.length;
            done(size > maximum ? new HttpError(413, 'Upload too large') : null, chunk);
          }
        });
        await pipeline(part.file, limit, output);
        if (part.file.truncated) throw new HttpError(413, 'Upload too large');
      }
      if (received.size !== 2) throw new HttpError(400, 'Video and thumbnail are required');
    } catch (error) {
      await Promise.all([...created].map((path) => rm(path, { force: true })));
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') throw new HttpError(409, 'Temporary file already exists');
      if (/Unexpected end of (form|multipart data|file)/.test((error as Error)?.message ?? '')) throw new HttpError(400, 'Invalid upload');
      throw error;
    }
  }

  /** Submits staged files once at a time using an exclusive .<videoId>.busy file in the temporary directory. */
  public async submit(videoId: string, action: () => Promise<void>): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(videoId)) throw new HttpError(400, 'Invalid video ID');
    const busy = join(this.directory, `.${videoId}.busy`);

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
