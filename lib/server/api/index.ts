import express from 'express';
import onFinished from 'on-finished';
import { authorizeHandler, loginHandler } from '@/server/handler/userHandler';
import { buildUserApi } from '@/server/api/userApi';
import { buildCommentApi } from '@/server/api/commentApi';
import { buildVideoApi } from '@/server/api/videoApi';
import { buildConfigApi } from '@/server/api/configApi';
import { Request } from '@/server/types/Request';
import { isInit } from '@/init';
import { OutgoingMessage } from 'http';
import { loadLogger } from '@/logging';

const getIp = function (req: Request): string {
  const xForwardedFor = req.headers['X-Forwarded-For'];
  const xForwardedForSingle = typeof xForwardedFor === 'object' ? xForwardedFor[0] : xForwardedFor;
  return xForwardedForSingle ?? req.socket.remoteAddress ?? '?';
};

const getContentLength = function (res: express.Response): number | undefined {
  const contentLengthHeader = res.getHeader('content-length');
  switch (typeof contentLengthHeader) {
    case 'number':
      return contentLengthHeader;
    case 'string':
      return contentLengthHeader ? Number(contentLengthHeader) : undefined;
    case 'object':
      return contentLengthHeader[0] ? Number(contentLengthHeader[0]) : undefined;
    case 'undefined':
    default:
      return undefined;
  }
};

const logAccessMiddleware: express.RequestHandler = function (req, res: express.Response, next) {
  const start = Date.now();

  const originalJson = res.json;

  res.json = function (body) {
    res.locals.responseBody = body;
    return originalJson.call(this, body);
  };

  const path = req.originalUrl;

  const ip = getIp(req);
  const method = req.method;
  const httpVersion = `HTTP/${req.httpVersion}`;
  const referer = req.headers.referer ?? '_';
  const userAgent = req.headers['user-agent'] ?? '_';

  onFinished<OutgoingMessage>(res, (): void => {
    const end = Date.now();
    const time = end - start;
    const contentLength = getContentLength(res);
    const statusCode = res.statusCode;
    const body = res.locals.responseBody;

    const logger = loadLogger();
    logger.access({ ip, method, path, httpVersion, statusCode, contentLength, referer, userAgent, time, error: body?.error });
  });

  next();
};

const buildApi = function (fallbacks: boolean) {
  const api = express();
  api.use(logAccessMiddleware);
  api.use(express.static('./web'));
  api.use(express.json());
  api.get('/init', async (_, res) => {
    const init = await isInit();
    res.status(200).json({ init });
  });
  api.post('/login', loginHandler);
  api.use('/api', authorizeHandler);
  api.use('/api/user', buildUserApi());
  api.use('/api/comment', buildCommentApi());
  api.use('/api/video', buildVideoApi());
  api.use('/api/config', buildConfigApi());

  if (fallbacks) {
    api.use((req, res) => {
      res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    api.use((error: Error, _: Request, res: express.Response, __: express.NextFunction) => {
      res.status(500).json({ error: error?.message ?? 'unknown error' });
    });
  }

  return api;
};

export { buildApi };
