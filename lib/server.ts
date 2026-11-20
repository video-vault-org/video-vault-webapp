import { createServer, Server } from 'node:http';
import { loadDb, resetDb } from '@/db';
import { loadStorage, resetStorage } from '@/storage';
import { AuthService } from '@/service/AuthService';
import { UserService } from '@/service/UserService';
import { VideoService } from '@/service/VideoService';
import { CommentService } from '@/service/CommentService';
import { createApp } from '@/http/app';

/**
 * Initializes configured adapters and one AuthService, then starts the HTTP server.
 * PORT defaults to 3000; HOST to 0.0.0.0; STATIC_DIRECTORY to ./public.
 * VIDEO_UPLOAD_LIMIT_BYTES and THUMBNAIL_UPLOAD_LIMIT_BYTES override the 2 GiB and 20 MiB defaults.
 * JWT_TTL_SECONDS overrides the default one-hour token lifetime.
 * Requires ./conf/db.json; JWT keys are loaded or created under ./jwtkeys.
 * @returns The listening server and an idempotent close function that closes the database.
 * @throws If configuration, initialization or listening fails; initialized resources are closed on failure.
 */
async function startServer({ port = Number(process.env.PORT ?? 3000), host = process.env.HOST ?? '0.0.0.0', staticDirectory = process.env.STATIC_DIRECTORY ?? './public' }: { port?: number; host?: string; staticDirectory?: string } = {}): Promise<{
  server: Server;
  close: () => Promise<void>;
}> {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('Invalid port');
  try {
    const db = await loadDb();
    const storage = await loadStorage();
    const auth = new AuthService(db, { tokenLifetimeSeconds: process.env.JWT_TTL_SECONDS === undefined ? undefined : Number(process.env.JWT_TTL_SECONDS) });
    await auth.initialize();
    const app = createApp(
      { auth, users: new UserService(db), videos: new VideoService(storage, db), comments: new CommentService(db) },
      {
        staticDirectory,
        maxVideoBytes: process.env.VIDEO_UPLOAD_LIMIT_BYTES === undefined ? undefined : Number(process.env.VIDEO_UPLOAD_LIMIT_BYTES),
        maxThumbnailBytes: process.env.THUMBNAIL_UPLOAD_LIMIT_BYTES === undefined ? undefined : Number(process.env.THUMBNAIL_UPLOAD_LIMIT_BYTES)
      }
    );
    const server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    let closing: Promise<void> | undefined;
    return {
      server,
      close: () => {
        closing ??= new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))).finally(async () => {
          resetStorage();
          await resetDb();
        });
        return closing;
      }
    };
  } catch (error) {
    resetStorage();
    await resetDb().catch(() => undefined);
    throw error;
  }
}

export { startServer };
