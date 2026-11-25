import { createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { access, link, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FastifyRequest } from 'fastify';
import { HttpError } from './errors';

interface UploadFile {
  kind: 'video' | 'thumbnail';
  size: number;
}

interface UploadSession {
  videoId: string;
  files: UploadFile[];
  complete: boolean;
}

const UPLOAD_PART_BYTES = 4 * 1024 ** 2;

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

  /** Receives bounded multipart files. New videos require both files; replacements may upload either file or both. */
  public async receive(request: FastifyRequest, videoId: string, { allowPartial = false }: { allowPartial?: boolean } = {}): Promise<void> {
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
      if (received.size === 0 || (!allowPartial && received.size !== 2)) throw new HttpError(400, allowPartial ? 'Video or thumbnail is required' : 'Video and thumbnail are required');
    } catch (error) {
      await Promise.all([...created].map((path) => rm(path, { force: true })));
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') throw new HttpError(409, 'Temporary file already exists');
      if (/Unexpected end of (form|multipart data|file)/.test((error as Error)?.message ?? '')) throw new HttpError(400, 'Invalid upload');
      throw error;
    }
  }

  /** Reserves isolated partial files after checking encrypted sizes. New videos require both kinds. */
  public async start(videoId: string, files: UploadFile[], { allowPartial = false }: { allowPartial?: boolean } = {}): Promise<string> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(videoId) || !files.length || files.length > 2 || new Set(files.map((file) => file.kind)).size !== files.length) throw new HttpError(400, 'Invalid upload');
    if (!allowPartial && (files.length !== 2 || !files.some((file) => file.kind === 'video') || !files.some((file) => file.kind === 'thumbnail'))) throw new HttpError(400, 'Video and thumbnail are required');
    for (const file of files) {
      if (!['video', 'thumbnail'].includes(file.kind) || !Number.isSafeInteger(file.size) || file.size < 1) throw new HttpError(400, 'Invalid upload');
      if (file.size > (file.kind === 'video' ? this.maxVideoBytes : this.maxThumbnailBytes)) throw new HttpError(413, 'Upload too large');
    }
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const uploadId = randomUUID();
    await this.submit(
      videoId,
      async () => {
        for (const file of files) {
          try {
            await access(join(this.directory, `${videoId}.${file.kind}`));
            throw new HttpError(409, 'Temporary file already exists');
          } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
          }
        }
        try {
          for (const file of files) {
            const handle = await open(this.partPath(uploadId, file.kind), 'wx', 0o600);
            await handle.close();
          }
          await writeFile(this.sessionPath(uploadId), JSON.stringify({ videoId, files, complete: false }), { flag: 'wx', mode: 0o600 });
        } catch (error) {
          await Promise.all(files.map((file) => rm(this.partPath(uploadId, file.kind), { force: true })));
          await rm(this.sessionPath(uploadId), { force: true });
          throw error;
        }
      },
      { files: [] }
    );
    return uploadId;
  }

  /** Writes at the expected offset. Repeating the same bytes is safe after an acknowledgement was lost. */
  public async append(videoId: string, uploadId: string, kind: UploadFile['kind'], offset: number, data: Buffer): Promise<number> {
    if (!Buffer.isBuffer(data) || !data.length || data.length > UPLOAD_PART_BYTES || !Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, 'Invalid upload part');
    return this.withSession(videoId, uploadId, async (session) => {
      const file = session.files.find((file) => file.kind === kind);
      if (!file || session.complete) throw new HttpError(409, 'Upload is not writable');
      if (offset + data.length > file.size) throw new HttpError(413, 'Upload exceeds declared size');
      const handle = await open(this.partPath(uploadId, kind), 'r+');
      const received = (await handle.stat()).size;
      try {
        if (offset > received) throw new HttpError(409, 'Unexpected upload offset');
        const overlap = Math.min(data.length, received - offset);
        if (overlap) {
          const previous = Buffer.alloc(overlap);
          let read = 0;
          while (read < overlap) {
            const { bytesRead } = await handle.read(previous, read, overlap - read, offset + read);
            if (!bytesRead) throw new HttpError(409, 'Incomplete upload part');
            read += bytesRead;
          }
          if (!previous.equals(data.subarray(0, overlap))) throw new HttpError(409, 'Conflicting upload part');
        }
        let written = overlap;
        try {
          while (written < data.length) {
            const result = await handle.write(data, written, data.length - written, offset + written);
            if (!result.bytesWritten) throw new Error('Upload write made no progress');
            written += result.bytesWritten;
          }
        } catch (error) {
          await handle.truncate(received);
          throw error;
        }
        return offset + data.length;
      } finally {
        await handle.close();
      }
    });
  }

  /** Publishes only complete files under the existing staging names. Completion can be retried safely. */
  public async complete(videoId: string, uploadId: string): Promise<void> {
    await this.withSession(videoId, uploadId, async (session) => {
      if (!session.complete) {
        await this.submit(
          videoId,
          async () => {
            for (const file of session.files) {
              if ((await stat(this.partPath(uploadId, file.kind))).size !== file.size) throw new HttpError(409, 'Upload is incomplete');
            }
            const published: string[] = [];
            try {
              for (const file of session.files) {
                const target = join(this.directory, `${videoId}.${file.kind}`);
                await link(this.partPath(uploadId, file.kind), target);
                published.push(target);
              }
              session.complete = true;
              await writeFile(this.sessionPath(uploadId), JSON.stringify(session), { mode: 0o600 });
            } catch (error) {
              await Promise.all(published.map((path) => rm(path, { force: true })));
              if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') throw new HttpError(409, 'Temporary file already exists');
              throw error;
            }
          },
          { files: [] }
        );
      }
      await Promise.all(session.files.map((file) => rm(this.partPath(uploadId, file.kind), { force: true })));
    });
  }

  /** Removes session metadata and partial files. Completed staging files remain available for submit. */
  public async cancel(videoId: string, uploadId: string): Promise<void> {
    try {
      await this.withSession(videoId, uploadId, async (session) => {
        await Promise.all(session.files.map((file) => rm(this.partPath(uploadId, file.kind), { force: true })));
        await rm(this.sessionPath(uploadId), { force: true });
      });
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 404)) throw error;
    }
  }

  /** Submits staged files once at a time using an exclusive .<videoId>.busy file in the temporary directory. */
  public async submit(videoId: string, action: () => Promise<void>, { files = ['video', 'thumbnail'] }: { files?: ('video' | 'thumbnail')[] } = {}): Promise<void> {
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
        await Promise.all(files.map((extension) => access(join(this.directory, `${videoId}.${extension}`))));
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new HttpError(404, 'Upload files not found');
        throw error;
      }
      await action();
    } finally {
      await rm(busy, { force: true });
    }
  }

  private sessionPath(uploadId: string): string {
    return join(this.directory, `.upload-${uploadId}.json`);
  }

  private partPath(uploadId: string, kind: UploadFile['kind']): string {
    return join(this.directory, `.upload-${uploadId}.${kind}.part`);
  }

  private async withSession<T>(videoId: string, uploadId: string, action: (session: UploadSession) => Promise<T>): Promise<T> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(videoId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uploadId)) throw new HttpError(400, 'Invalid upload ID');
    const lock = join(this.directory, `.upload-${uploadId}.lock`);
    try {
      await writeFile(lock, '', { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') throw new HttpError(409, 'Upload is busy');
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new HttpError(404, 'Upload not found');
      throw error;
    }
    try {
      let session: UploadSession;
      try {
        session = JSON.parse(await readFile(this.sessionPath(uploadId), 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new HttpError(404, 'Upload not found');
        throw error;
      }
      if (session.videoId !== videoId) throw new HttpError(404, 'Upload not found');
      return await action(session);
    } finally {
      await rm(lock, { force: true });
    }
  }
}

export { UploadStore, UPLOAD_PART_BYTES };
