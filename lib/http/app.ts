import express, { Express } from 'express';
import { z } from 'zod';
import { AuthService } from '@/service/AuthService';
import { UserService } from '@/service/UserService';
import { VideoService } from '@/service/VideoService';
import { CommentService } from '@/service/CommentService';
import { authentication } from './middleware';
import { handleErrors, HttpError } from './errors';
import { UploadStore } from './uploads';
import { userRoutes } from './routes/users';
import { videoRoutes } from './routes/videos';
import { commentRoutes } from './routes/comments';
import { text } from './validation';
import { Logger } from 'pino';
import { logger as defaultLogger, requestLogging } from './logging';

/**
 * Creates the Express backend without opening a listening socket.
 * Services must be initialized. temporaryDirectory must match the StorageWrapper's temporary directory.
 * API requests use Bearer JWTs; only explicitly granted roles allow privileged operations.
 */
function createApp(
  { auth, users, videos, comments }: { auth: AuthService; users: UserService; videos: VideoService; comments: CommentService },
  {
    staticDirectory = './public',
    temporaryDirectory = './tmp',
    maxVideoBytes,
    maxThumbnailBytes,
    logger = defaultLogger
  }: { staticDirectory?: string; temporaryDirectory?: string; maxVideoBytes?: number; maxThumbnailBytes?: number; logger?: Logger } = {}
): Express {
  const app = express();
  app.use(requestLogging(logger));
  const uploads = new UploadStore({ directory: temporaryDirectory, maxVideoBytes, maxThumbnailBytes });
  const json = express.json({ limit: '1mb' });
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(['/api', '/login'], (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  /** POST /login — Public. JSON body: username and the client's Base64 loginHash. Returns { token }, or 401 for failure/lock. */
  app.post('/login', json, async (request, response) => {
    const credentials = z.object({ username: text, loginHash: text }).strict().parse(request.body);
    const token = await auth.login(credentials);
    if (!token) throw new HttpError(401, 'Invalid credentials or account locked');
    response.json({ token });
  });

  app.use('/api', authentication(auth), json);
  app.use('/api/user', userRoutes(users, auth));
  app.use('/api/video', videoRoutes(videos, auth, uploads));
  app.use('/api', commentRoutes(comments, videos, auth));
  app.use('/api', (_request, _response) => {
    throw new HttpError(404, 'Route not found');
  });

  /** GET/HEAD for non-API paths — Public. Serves files only from staticDirectory; dotfiles and directory redirects are disabled. */
  app.use(express.static(staticDirectory, { dotfiles: 'deny', redirect: false }));
  app.use((_request, _response) => {
    throw new HttpError(404, 'Not found');
  });
  app.use(handleErrors);
  return app;
}

export { createApp };
