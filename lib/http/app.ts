import Fastify, { FastifyInstance, FastifyServerOptions, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import Ajv, { AnySchema } from 'ajv';
import addFormats from 'ajv-formats';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { AuthService } from '@/service/AuthService';
import { UserService } from '@/service/UserService';
import { VideoService } from '@/service/VideoService';
import { CommentService } from '@/service/CommentService';
import { sessionSecurity } from './sessions';
import { authentication } from './middleware';
import { handleErrors, HttpError } from './errors';
import { UploadStore } from './uploads';
import { userRoutes } from './routes/users';
import { videoRoutes } from './routes/videos';
import { commentRoutes } from './routes/comments';
import { Type, object, text, username, errorResponses } from './validation';
import { loggingOptions, HttpLogController } from './logging';
import { registerDocumentation } from './documentation';
import { AppConfig, appConfigSchema, DEFAULT_APP_TITLE } from '@/app/config/AppConfig';
import { MetaConfig, DEFAULT_META_CONFIG, metaConfigSchema } from '@/meta/config/MetaConfig';
import { metaConfigResponse } from './metaSchema';
import { escapeHtml, setPageTitle } from '@/util/html';
import { basePolicy, workerPolicy, loadFrontendSecurity } from './frontendSecurity';

/** Creates Fastify/Pino before adapter initialization. Trusts loopback proxies by default; VIDEO_VAULT_TRUST_PROXY replaces this list. */
const createHttpServer = function ({
  logger = loggingOptions(),
  trustProxy = process.env.VIDEO_VAULT_TRUST_PROXY?.trim() || '127.0.0.1,::1'
}: { logger?: FastifyServerOptions['logger']; trustProxy?: FastifyServerOptions['trustProxy'] } = {}): FastifyInstance {
  const app = Fastify({ logger, trustProxy, genReqId: () => randomUUID(), logController: new HttpLogController(), bodyLimit: 1024 * 1024, routerOptions: { maxParamLength: 4096, ignoreTrailingSlash: true } });
  const strict = addFormats(new Ajv({ removeAdditional: false, coerceTypes: false, useDefaults: true }));
  const query = addFormats(new Ajv({ removeAdditional: false, coerceTypes: true, useDefaults: true }));

  app.setValidatorCompiler(({ schema, httpPart }) => (httpPart === 'querystring' ? query : strict).compile(schema as AnySchema));

  app.decorateRequest('user', null);
  app.decorateRequest('failure', null);
  app.decorateRequest('authSession', null);
  app.decorateRequest('sessionId', '');

  app.setErrorHandler(handleErrors);

  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('X-Request-ID', request.id)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY')
      .header('X-Robots-Tag', 'noindex, nofollow, noimageindex')
      .header('Content-Security-Policy', `${basePolicy}; script-src 'none'`);
  });

  return app;
};

/**
 * Registers the backend without opening a listening socket. Call ready()/inject() before use, close() after use.
 * Auth runs before parsing and schema validation. Every JSON API route has a compiled response schema.
 * instanceSalt is the stable public value loaded from ./.salt at startup; /bootstrap serves it without file access.
 * temporaryDirectory must match the StorageWrapper. Bodies, headers and query secrets are excluded from logs.
 */
const createApp = function (
  { auth, users, videos, comments }: { auth: AuthService; users: UserService; videos: VideoService; comments: CommentService },
  {
    instanceSalt,
    appConfig = { title: DEFAULT_APP_TITLE },
    metaConfig = DEFAULT_META_CONFIG,
    staticDirectory = './public',
    temporaryDirectory = './tmp',
    maxVideoBytes,
    maxThumbnailBytes,
    insecureLocalCookies = false,
    logger,
    instance
  }: {
    instanceSalt: string;
    appConfig?: AppConfig;
    metaConfig?: MetaConfig;
    staticDirectory?: string;
    temporaryDirectory?: string;
    maxVideoBytes?: number;
    maxThumbnailBytes?: number;
    insecureLocalCookies?: boolean;
    logger?: FastifyServerOptions['logger'];
    instance?: FastifyInstance;
  }
): FastifyInstance {
  if (insecureLocalCookies && process.env.NODE_ENV === 'production') throw new Error('Insecure development cookies are disabled in production');
  if (instanceSalt.length !== 64 || !/^[0-9a-f]{64}$/i.test(instanceSalt)) throw new TypeError('Instance salt must contain exactly 64 hexadecimal characters');
  const { title } = appConfigSchema.parse(appConfig);
  const meta = metaConfigSchema.parse(metaConfig);
  const app = instance ?? createHttpServer({ logger });
  const uploads = new UploadStore({ directory: temporaryDirectory, maxVideoBytes, maxThumbnailBytes });
  const cookies = sessionSecurity(auth, insecureLocalCookies);
  const authenticate = authentication(auth, cookies);
  registerDocumentation(app, { title, maxVideoBytes, maxThumbnailBytes, sessionCookieName: cookies.cookieName });

  app.addHook('onRequest', async (request, reply) => {
    const path = request.routeOptions.url ?? request.url.split('?')[0];
    if (path === '/session' || path === '/login' || path.startsWith('/login/') || path === '/api' || path.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (path === '/api' || path.startsWith('/api/')) {
      await authenticate.call(app, request, reply);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) cookies.verify(request, request.authSession);
    }
    if (path === '/login' && request.method === 'POST') {
      const sessionId = cookies.credential(request);
      cookies.verify(request, sessionId ? await auth.findSession({ sessionId }) : null);
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const path = request.routeOptions.url;
    const target = (request.params as { userId?: string })?.userId;
    const deletion = request.method === 'DELETE' && (path === '/api/user/delete' || path === '/api/user/delete/:userId');
    const credentialsChanged = request.method === 'PATCH' && /^\/api\/user\/change\/(password|username)(\/|$)/.test(path ?? '');
    if (reply.statusCode === 204 && (deletion || credentialsChanged) && (target === undefined || target === request.user?.userId)) cookies.clear(reply);
    return payload;
  });

  app.register(multipart, { limits: { files: 2, fields: 0, parts: 2, fileSize: Math.max(maxVideoBytes ?? 2 * 1024 ** 3, maxThumbnailBytes ?? 20 * 1024 ** 2) } });

  app.register(async (router) => {
    const routes = router.withTypeProvider<TypeBoxTypeProvider>();

    /** GET /bootstrap — Public. Returns protocol version 1, the public instance salt, application title and frontend metadata configuration. */
    routes.get(
      '/bootstrap',
      {
        schema: {
          response: {
            200: object({ version: Type.Literal(1), instanceSalt: Type.String({ minLength: 64, maxLength: 64, pattern: '^[0-9a-fA-F]{64}$' }), app: object({ title: Type.String({ minLength: 1, maxLength: 100 }) }), meta: metaConfigResponse }),
            ...errorResponses
          }
        }
      },
      async (_request, reply) => {
        reply.header('Cache-Control', 'no-store');
        return { version: 1 as const, instanceSalt, app: { title }, meta };
      }
    );

    /** GET /session — Public. Returns a no-store CSRF challenge or current session metadata; never returns the cookie credential. */
    routes.get('/session', { schema: { response: { 200: object({ authenticated: Type.Boolean(), csrfToken: text, expiresAt: Type.Union([Type.Number(), Type.Null()]) }), ...errorResponses } } }, async (request, reply) => {
      const sessionId = cookies.credential(request);
      const session = sessionId ? await auth.findSession({ sessionId }) : null;
      return session ? { authenticated: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt } : { authenticated: false, csrfToken: cookies.challenge(reply), expiresAt: null };
    });

    /** POST /login — Public with a pre-login CSRF challenge. Creates a new HttpOnly session cookie. */
    routes.post('/login', { schema: { body: object({ username, loginHash: text }), response: { 200: object({ authenticated: Type.Literal(true), csrfToken: text, expiresAt: Type.Number() }), ...errorResponses } } }, async (request, reply) => {
      const sessionId = await auth.login(request.body);
      if (!sessionId) throw new HttpError(401, 'Invalid credentials or account locked');
      const session = await auth.findSession({ sessionId });
      if (!session) throw new HttpError(401, 'Session revoked');
      const previous = cookies.credential(request);
      if (previous) await auth.logout({ sessionId: previous });
      cookies.issue(reply, sessionId, session.expiresAt);
      return { authenticated: true as const, csrfToken: session.csrfToken, expiresAt: session.expiresAt };
    });

    /** POST /api/logout — Any authenticated user with CSRF proof. Revokes this session and clears its cookie. */
    routes.post('/api/logout', { schema: { response: { 204: Type.Null(), ...errorResponses } } }, async (request, reply) => {
      await auth.logout({ sessionId: request.sessionId });
      cookies.clear(reply);
      return reply.code(204).send(null);
    });

    /** POST /api/logout-everywhere — Any authenticated user with CSRF proof. Revokes all their sessions. */
    routes.post('/api/logout-everywhere', { schema: { response: { 204: Type.Null(), ...errorResponses } } }, async (request, reply) => {
      await auth.logoutEverywhere({ userId: request.user!.userId });
      cookies.clear(reply);
      return reply.code(204).send(null);
    });
  });

  app.register(async (router) => userRoutes(router, users, auth), { prefix: '/api/user' });

  app.register(async (router) => videoRoutes(router, videos, auth, uploads), { prefix: '/api/video' });

  app.register(async (router) => commentRoutes(router, comments, videos, auth), { prefix: '/api' });

  app.register(async (router) => {
    const html = setPageTitle(await readFile(resolve(staticDirectory, 'index.html'), 'utf8'), title);
    const security = await loadFrontendSecurity(resolve(staticDirectory), html);

    // Immutable assets use verified memory; worker branding updates must still match the retained template.
    const asset = async function (request: FastifyRequest, reply: FastifyReply) {
      const path = request.url.split('?')[0];
      const bytes = path === '/sw.js' && security.worker ? await security.worker() : security.assets.get(path);
      if (!bytes) throw new HttpError(404, 'Not found');
      const mime = path.endsWith('.js') ? 'text/javascript; charset=utf-8' : path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
      return reply
        .type(mime)
        .header('Content-Security-Policy', workerPolicy)
        .header('Cache-Control', path === '/sw.js' ? 'no-cache' : 'public, max-age=31536000, immutable')
        .send(bytes);
    };

    router.get('/assets/*', { schema: { hide: true } }, asset);

    if (security.assets.has('/sw.js')) router.get('/sw.js', { schema: { hide: true } }, asset);

    /** GET/HEAD / and /index.html — Public. Adds request-specific, absolute OG page/image URLs without query or fragment data. */
    const index = async function (request: FastifyRequest, reply: FastifyReply) {
      let pageUrl: string;
      try {
        if (!['http', 'https'].includes(request.protocol) || !request.host || /[\s/\\?#@]/.test(request.host)) throw new Error('Invalid origin');
        pageUrl = new URL('/', `${request.protocol}://${request.host}`).href;
      } catch {
        throw new HttpError(400, 'Invalid request origin');
      }
      return reply
        .type('text/html; charset=utf-8')
        .header('Content-Security-Policy', security.policy)
        .header('Cache-Control', 'no-store')
        .send(html.replace('content="__VIDEOVAULT_OG_URL__"', () => `content="${escapeHtml(pageUrl)}"`).replace('content="__VIDEOVAULT_OG_IMAGE_URL__"', () => `content="${escapeHtml(new URL('/logo.png', pageUrl).href)}"`));
    };

    router.get('/', { schema: { hide: true } }, index);

    router.get('/index.html', { schema: { hide: true } }, index);
  });

  /** GET/HEAD for non-API paths — Public. Serves only public files; dotfiles and directory redirects are disabled. */
  app.register(staticFiles, {
    root: resolve(staticDirectory),
    dotfiles: 'deny',
    redirect: false,
    index: false,

    allowedPath: (_path, _root, request) =>
      !/^\/api(?:\/|\?|$)/.test(request.url) &&
      !request.url
        .split('?')[0]
        .split('/')
        .some((part) => part.startsWith('.'))
  });

  app.setNotFoundHandler(async () => {
    throw new HttpError(404, 'Not found');
  });

  return app;
};

export { createApp, createHttpServer };
