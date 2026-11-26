import { FastifyInstance, FastifySchema } from 'fastify';
import { randomBytes } from 'node:crypto';
import { basePolicy } from './frontendSecurity';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { authorization } from './middleware';
import { DEFAULT_APP_TITLE } from '@/app/config/AppConfig';

const summaries: Record<string, string> = {
  'GET /bootstrap': 'Get public application and metadata settings and the instance salt',
  'POST /login': 'Log in',
  'POST /api/user/initialize-keys': 'Initialize your archive keys once',
  'POST /api/user/add': 'Create a user',
  'GET /api/user/me': 'Get your account',
  'GET /api/user/all': 'List users',
  'GET /api/user/find/:userId': 'Find a user',
  'PATCH /api/user/change/displayname/:userId/:displayname': "Change a user's display name",
  'PATCH /api/user/change/displayname/:displayname': 'Change your display name',
  'PATCH /api/user/change/username/:userId/:username': "Change a user's username after verifying the acting admin password",
  'PATCH /api/user/change/username/:username': 'Change your username after verifying your current password',
  'PATCH /api/user/change/password/:userId': "Change a user's password attributes after verifying the acting admin password",
  'PATCH /api/user/change/password': 'Change your password attributes after verifying your current password',
  'PATCH /api/user/change/admin/:userId': 'Change the admin role',
  'PATCH /api/user/change/editor/:userId': 'Change the editor role',
  'PATCH /api/user/change/moderator/:userId': 'Change the moderator role',
  'DELETE /api/user/delete/:userId': 'Delete a user and clear their comments',
  'DELETE /api/user/delete': 'Delete your account and clear your comments',
  'POST /api/video/upload/:videoId': 'Upload temporary video and thumbnail files',
  'POST /api/video/upload/:videoId/start': 'Reserve a bounded packet upload and check encrypted sizes',
  'PUT /api/video/upload/:videoId/:uploadId/:kind': 'Store and acknowledge one encrypted upload packet',
  'POST /api/video/upload/:videoId/:uploadId/complete': 'Complete packet upload and stage files for submit',
  'DELETE /api/video/upload/:videoId/:uploadId': 'Discard upload session and partial files',
  'POST /api/video/submit': 'Submit a new video',
  'PATCH /api/video/change/title/:videoId': 'Change a video title',
  'PATCH /api/video/change/description/:videoId': 'Change the encrypted video description',
  'PATCH /api/video/change/metadata/:videoId': 'Change video metadata',
  'PATCH /api/video/change/files/:videoId': 'Replace video and/or thumbnail files',
  'PATCH /api/video/change/recorded/:videoId': 'Change the video recording date',
  'DELETE /api/video/delete/:videoId': 'Permanently tombstone a video and delete its comments and files',
  'HEAD /api/video/file/:videoId': 'Get the encrypted video byte length',
  'GET /api/video/all': 'List all active videos',
  'GET /api/video/find/:videoId': 'Find a video',
  'GET /api/video/file/:videoId': 'Download encrypted video bytes',
  'GET /api/video/thumbnail/:videoId': 'Download encrypted thumbnail bytes',
  'GET /api/video/:since': 'Find video changes, including permanent deletion tombstones',
  'POST /api/comment/submit': 'Post a comment',
  'GET /api/comments/:videoId': 'List comments, newest first, with cursor pagination',
  'PATCH /api/comment/change/own/:commentId': 'Change your own comment',
  'PATCH /api/comment/change/:commentId': 'Change a comment',
  'DELETE /api/comment/delete/own/:commentId': 'Soft-delete your own comment and clear its content',
  'DELETE /api/comment/delete/:commentId': 'Soft-delete a comment and clear its content'
};

/**
 * Registers public Swagger UI at /docs and OpenAPI JSON/YAML at /docs/json and /docs/yaml.
 * Must run before API route plugins. Documentation reuses runtime schemas; documentation-only multipart schemas never validate stream bodies.
 * Required roles are read from the authorization hooks, so the documentation follows the actual access rules.
 */
const registerDocumentation = function (app: FastifyInstance, { title = DEFAULT_APP_TITLE, maxVideoBytes = 2 * 1024 ** 3, maxThumbnailBytes = 20 * 1024 ** 2 }: { title?: string; maxVideoBytes?: number; maxThumbnailBytes?: number } = {}): void {
  app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: `${title} API`,
        version: '0.0.1',
        description:
          'Encrypted video collection API. Load /bootstrap for the public instance salt before deriving the Base64 loginHash. Login expects that loginHash, not a plaintext password. Use the returned JWT in Authorize. Admin, editor and moderator roles are independent.'
      },
      tags: [{ name: 'Authentication' }, { name: 'Users' }, { name: 'Videos' }, { name: 'Comments' }],
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } }
    },

    transform: ({ schema, url, route }) => {
      const login = url === '/login';
      const bootstrap = url === '/bootstrap';
      const publicRoute = login || bootstrap;
      if (!publicRoute && !url.startsWith('/api/')) return { schema: { ...schema, hide: true }, url };
      const method = Array.isArray(route.method) ? route.method[0] : route.method;
      const hooks = route.onRequest ? (Array.isArray(route.onRequest) ? route.onRequest : [route.onRequest]) : [];
      const roles = hooks.flatMap((hook) => (hook as Partial<ReturnType<typeof authorization>>).requiredRoles ?? []);
      const tag = publicRoute ? 'Authentication' : url.startsWith('/api/user/') ? 'Users' : url.startsWith('/api/video/') ? 'Videos' : 'Comments';
      let description = bootstrap
        ? 'Public. Returns protocol version 1, the configured application title, frontend metadata settings and the stable public instance salt as 64 hexadecimal characters. Cache-Control: no-store. No authentication required.'
        : login
          ? 'Public. Supply the client-derived loginHash as Base64.'
          : roles.length
            ? `Requires role: ${roles.join(' or ')}.`
            : 'Requires an authenticated user.';
      if (roles.includes('admin') && !['GET', 'HEAD', 'OPTIONS'].includes(method))
        description += ' Requires oldLoginHash derived from the acting admin’s current password in the JSON body. Verification shares login failure counters and lock durations.';
      if (url === '/api/user/initialize-keys')
        description += ' Stores the first wrapped archive keys and password-key salt for the current admin only. Requires an empty userKey; concurrent or repeated initialization returns 409. The login proof is unchanged.';
      if (url.includes('/own/')) description += ' Only comments belonging to the current user can be changed.';
      if (url === '/api/video/change/files/:videoId')
        description += ' Upload first. Supply videoMimeType and/or thumbnailMimeType, plus lastModified and hmac. Only selected files are replaced. Failures may leave partial Storage changes; temporary files remain for retry.';
      if (url === '/api/video/delete/:videoId')
        description +=
          ' Requires JSON { lastModified } with the client deletion timestamp. Stores a permanent, unverified tombstone and clears content before removing files and comments. Repeating deletion retries cleanup without changing the original timestamp.';
      if (url === '/api/video/:since')
        description +=
          ' Includes permanent unverified tombstones (deleted=true, cleared content, empty hmac, recorded at the Unix epoch). Remove these IDs and cached thumbnails locally, and advance the watermark using their lastModified too. Active records have deleted=false.';
      if (url === '/api/video/submit') description += ' Requires both temporary files to have been uploaded with the same videoId.';
      const documented: FastifySchema = {
        ...schema,
        summary: summaries[`${method} ${url}`] ?? `${method} ${url}`,
        description,
        tags: [tag],
        security: publicRoute ? [] : [{ bearerAuth: [] }],
        operationId: `${method.toLowerCase()}_${url.replace(/[:*]/g, '').split('/').filter(Boolean).join('_')}`
      };
      if (url === '/api/video/upload/:videoId') {
        documented.description += ' New videos require both files. Existing videos accept video, thumbnail or both. Files are staged until submit.';
        documented.consumes = ['multipart/form-data'];
        documented.body = {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            video: { type: 'string', format: 'binary', description: `Video file, maximum ${maxVideoBytes} bytes.` },
            thumbnail: { type: 'string', format: 'binary', description: `Thumbnail file, maximum ${maxThumbnailBytes} bytes.` }
          }
        };
      }
      if (method === 'PUT' && url === '/api/video/upload/:videoId/:uploadId/:kind') {
        documented.consumes = ['application/octet-stream'];
        documented.body = { type: 'string', format: 'binary' };
        documented.description +=
          ' Maximum 4 MiB per request. offset is the encrypted byte offset. Identical retries are accepted; gaps and conflicting bytes are rejected. received acknowledges the end offset of this packet after writing it to the temporary file.';
      }
      if (method !== 'HEAD' && (url === '/api/video/file/:videoId' || url === '/api/video/thumbnail/:videoId')) {
        documented.response = { ...(documented.response as Record<string, unknown>), 200: { description: 'Encrypted file bytes', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } } };
      }
      if (url === '/api/video/file/:videoId') {
        const headers = { 'Content-Length': { description: 'Encrypted byte length', schema: { type: 'integer' } }, 'Accept-Ranges': { schema: { type: 'string', example: 'bytes' } } };
        if (method === 'HEAD') documented.response = { ...(documented.response as Record<string, unknown>), 200: { description: 'Encrypted size without a response body', headers } };
        else {
          documented.description += ' Optional Range: bytes=from-to, bytes=from- or bytes=-suffix. Query bounds and Range cannot be combined. Unsatisfiable or multiple ranges return 416.';
          documented.headers = { type: 'object', properties: { Range: { type: 'string', example: 'bytes=0-39' } }, additionalProperties: true };
          documented.response = {
            ...(documented.response as Record<string, unknown>),
            206: {
              description: 'Inclusive encrypted byte range',
              headers: { ...headers, 'Content-Range': { schema: { type: 'string', example: 'bytes 0-39/12345' } } },
              content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } }
            }
          };
        }
      }
      return { schema: documented, url };
    }
  });

  app.register(async (docs) => {
    docs.addHook('onSend', async (_request, reply, payload) => {
      if (typeof payload !== 'string' || !String(reply.getHeader('content-type')).startsWith('text/html')) return payload;
      const nonce = randomBytes(24).toString('base64');
      reply
        .header('Cache-Control', 'no-store')
        .header(
          'Content-Security-Policy',
          `${basePolicy}; script-src 'nonce-${nonce}' 'strict-dynamic'; script-src-attr 'none'; connect-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self'; style-src-elem 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'`
        );
      return payload.replace(/<script\b/g, `<script nonce="${nonce}"`);
    });

    docs.register(swaggerUi, {
      routePrefix: '/docs',
      staticCSP: false,
      uiConfig: { deepLinking: true, docExpansion: 'list', persistAuthorization: false, validatorUrl: null }
    });
  });
};

export { registerDocumentation };
