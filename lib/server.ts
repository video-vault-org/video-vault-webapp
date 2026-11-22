import { readServerPort } from '@/cli/server';
import { prepareFrontend } from '@/images';
import { Server } from 'node:http';
import { loadDb, resetDb } from '@/db';
import { loadStorage, resetStorage } from '@/storage';
import { AuthService } from '@/service/AuthService';
import { UserService } from '@/service/UserService';
import { VideoService } from '@/service/VideoService';
import { CommentService } from '@/service/CommentService';
import { createApp, createHttpServer } from '@/http/app';
import { startTemporaryFileCleanup } from '@/jobs/temporaryFileCleanup';
import { ensureInstanceSalt } from '@/util/instanceSalt';
import { loadConfig as loadAppConfig } from '@/app';
import { DEFAULT_APP_TITLE } from '@/app/config/AppConfig';
import { loadConfig as loadMetaConfig } from '@/meta';
import { DEFAULT_META_CONFIG } from '@/meta/config/MetaConfig';

/**
 * Ensures ./.salt exists, initializes configured adapters and one AuthService, then starts the HTTP server.
 * VIDEO_VAULT_PORT sets the port; otherwise prompts on an interactive terminal (default 3210) or uses 3210 without a terminal.
 * An explicit port option skips the prompt and overrides VIDEO_VAULT_PORT. HOST defaults to 0.0.0.0; STATIC_DIRECTORY to ./public.
 * VIDEO_UPLOAD_LIMIT_BYTES and THUMBNAIL_UPLOAD_LIMIT_BYTES override the 2 GiB and 20 MiB defaults.
 * JWT_TTL_SECONDS overrides the default one-hour token lifetime.
 * Temporary files with ctime older than 24 hours are cleaned on startup and hourly.
 * Prepares configured ./img branding and its service worker version in the static directory before listening.
 * Requires ./conf/db.json; JWT keys are loaded or created under ./jwtkeys.
 * @returns The listening server and an idempotent close function that stops temporary-file cleanup and closes the database.
 * @throws If configuration, initialization or listening fails; initialized resources are closed on failure.
 */
const startServer = async function ({ port, host = process.env.HOST ?? '0.0.0.0', staticDirectory = process.env.STATIC_DIRECTORY ?? './public' }: { port?: number; host?: string; staticDirectory?: string } = {}): Promise<{
  server: Server;
  close: () => Promise<void>;
}> {
  const app = createHttpServer();
  try {
    const listenPort = port ?? (await readServerPort());
    if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) throw new RangeError('Invalid port');
    const instanceSalt = await ensureInstanceSalt();
    const appConfig = (await loadAppConfig()) ?? { title: DEFAULT_APP_TITLE };
    const metaConfig = (await loadMetaConfig()) ?? DEFAULT_META_CONFIG;
    await prepareFrontend({ staticDirectory });
    const db = await loadDb(appConfig);
    const storage = await loadStorage();
    const auth = new AuthService(db, { tokenLifetimeSeconds: process.env.JWT_TTL_SECONDS === undefined ? undefined : Number(process.env.JWT_TTL_SECONDS) });
    await auth.initialize();
    createApp(
      { auth, users: new UserService(db), videos: new VideoService(storage, db, { logger: app.log }), comments: new CommentService(db) },
      {
        instanceSalt,
        appConfig,
        metaConfig,
        instance: app,
        staticDirectory,
        maxVideoBytes: process.env.VIDEO_UPLOAD_LIMIT_BYTES === undefined ? undefined : Number(process.env.VIDEO_UPLOAD_LIMIT_BYTES),
        maxThumbnailBytes: process.env.THUMBNAIL_UPLOAD_LIMIT_BYTES === undefined ? undefined : Number(process.env.THUMBNAIL_UPLOAD_LIMIT_BYTES)
      }
    );
    await app.listen({ port: listenPort, host });
    const server = app.server;
    const stopCleanup = startTemporaryFileCleanup({ logger: app.log });
    let closing: Promise<void> | undefined;
    return {
      server,

      close: () => {
        if (!closing) app.log.info('Server shutdown started...');
        closing ??= app
          .close()
          .finally(async () => {
            await stopCleanup();
            resetStorage();
            await resetDb();
          })
          .catch((error: unknown) => {
            app.log.error({ err: error }, 'Shutdown failed');
            throw error;
          });
        return closing;
      }
    };
  } catch (error) {
    app.log.error({ err: error }, 'Startup failed');
    await app.close().catch(() => undefined);
    resetStorage();
    await resetDb().catch(() => undefined);
    throw error;
  }
};

export { startServer };
