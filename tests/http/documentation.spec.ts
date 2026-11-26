import { DEFAULT_META_CONFIG } from '@/meta/config/MetaConfig';
import { FastifyInstance } from 'fastify';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '@/http/app';
import { AuthService } from '@/service/AuthService';
import { UserService } from '@/service/UserService';
import { VideoService } from '@/service/VideoService';
import { CommentService } from '@/service/CommentService';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';
import { StorageWrapper } from '@/storage/StorageWrapper';

/** Resolves local schema references so assertions also work when Swagger hoists shared schemas. */
const dereference = function (document: Record<string, unknown>, input: unknown): Record<string, unknown> {
  let schema = input as Record<string, unknown>;
  while (typeof schema.$ref === 'string') {
    schema = schema.$ref
      .slice(2)
      .split('/')
      .reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], document) as Record<string, unknown>;
  }
  return schema;
};

describe('Swagger UI and OpenAPI documentation', () => {
  let app: FastifyInstance;
  let directory: string;
  let auth: AuthService;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'video-vault-docs-'));
    await writeFile(join(directory, 'index.html'), 'Public site');
    const db = new InMemoryDatabaseAdapter();
    auth = new AuthService(db);
    jest.spyOn(auth, 'findSession').mockResolvedValue({
      user: { userId: 'editor', username: 'editor', displayName: 'Editor', loginHash: 'private-hash-never-in-docs', passwordKeySalt: 'salt', userKey: 'key', admin: false, editor: true, moderator: false },
      expiresAt: Date.now() + 3600_000,
      csrfToken: 'c'.repeat(43)
    });
    app = createApp(
      { auth, users: new UserService(db), videos: new VideoService(new StorageWrapper(new InMemoryStorageAdapter(), { temporaryDirectory: join(directory, 'tmp') }), db), comments: new CommentService(db) },
      {
        instanceSalt: 'ab'.repeat(32),
        logger: false,
        staticDirectory: directory,
        temporaryDirectory: join(directory, 'tmp'),
        maxVideoBytes: 12345,
        maxThumbnailBytes: 6789
      }
    );
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  test('serves public Swagger UI and its local assets with a CSP', async () => {
    const ui = await app.inject('/docs/');
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
    expect(ui.body).toContain('swagger-ui');
    expect(ui.headers['content-security-policy']).toContain("default-src 'none'");
    expect(ui.headers['content-security-policy']).toContain("'strict-dynamic'");
    expect(ui.headers['content-security-policy']).toMatch(/script-src 'nonce-/);
    const another = await app.inject('/docs/');
    expect(another.headers['content-security-policy']).not.toBe(ui.headers['content-security-policy']);
    expect(ui.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    const css = await app.inject('/docs/static/swagger-ui.css');
    expect(css.statusCode).toBe(200);
    expect(css.headers['content-type']).toContain('text/css');
    const script = await app.inject('/docs/static/swagger-initializer.js');
    expect(script.statusCode).toBe(200);
    expect(script.body).toMatch(/persistAuthorization["']?\s*:\s*false/);
    expect(script.body).toMatch(/validatorUrl["']?\s*:\s*null/);
    expect((await app.inject('/')).body).toBe('Public site');
  });

  test('discovers login and every API operation, excluding UI/static routes and implicit HEAD routes', async () => {
    const response = await app.inject('/docs/json');
    expect(response.statusCode).toBe(200);
    const document = response.json();
    expect(document.openapi).toBe('3.0.3');
    expect(document.info.title).toBe('VideoVault API');
    expect(document.paths['/login'].post.summary).toBe('Log in');
    expect(document.paths['/api/video/change/files/{videoId}'].patch).toBeDefined();
    expect(document.paths['/api/comments/{videoId}'].get).toBeDefined();
    expect(document.paths['/api/user/change/displayname/{userId}/{displayname}'].patch).toBeDefined();
    expect(Object.keys(document.paths).every((path) => path === '/session' || path === '/login' || path === '/bootstrap' || path.startsWith('/api/'))).toBe(true);
    const ids: string[] = [];
    for (const path of Object.keys(document.paths)) {
      if (path === '/api/video/file/{videoId}') expect(document.paths[path].head).toBeDefined();
      else expect(document.paths[path].head).toBeUndefined();
      for (const method of ['get', 'head', 'post', 'put', 'patch', 'delete']) {
        const operation = document.paths[path][method];
        if (!operation) continue;
        expect(operation.summary).toBeTruthy();
        expect(operation.tags).toHaveLength(1);
        ids.push(operation.operationId);
      }
    }
    expect(document.paths['/api/video/catalog']).toBeUndefined();
    expect(document.paths['/api/video/delete/{videoId}'].delete.description).toContain('lastModified');
    expect(document.paths['/api/video/{since}'].get.description).toContain('tombstones');
    expect(ids).toHaveLength(45);
    expect(document.paths).not.toHaveProperty('/api/comment/find/{commentId}');
    expect(new Set(ids).size).toBe(ids.length);
    expect(response.body).not.toContain('private-hash-never-in-docs');
  });

  test('requires a current admin proof in every writing admin operation', async () => {
    const document = (await app.inject('/docs/json')).json();
    let checked = 0;
    for (const path of Object.keys(document.paths)) {
      for (const method of ['post', 'patch', 'put', 'delete']) {
        const operation = document.paths[path][method];
        if (!operation?.description.includes('Requires role: admin')) continue;
        const schema = operation.requestBody.content['application/json'].schema;
        const body = schema.$ref ? document.components.schemas[schema.$ref.split('/').pop()] : schema;
        expect(body.required).toContain('oldLoginHash');
        expect(operation.description).toContain('acting admin');
        checked++;
      }
    }
    expect(checked).toBe(9);
    expect(document.paths['/api/user/all'].get.requestBody).toBeUndefined();
  });

  test('documents cookie sessions and actual role requirements without making API access public', async () => {
    const document = (await app.inject('/docs/json')).json();
    expect(document.components.securitySchemes.cookieAuth).toEqual({ type: 'apiKey', in: 'cookie', name: '__Host-videovault-session' });
    expect(document.paths['/login'].post.security).toEqual([{ csrf: [] }]);
    expect(document.paths['/api/user/initialize-keys'].post.description).toContain('admin');
    expect(document.paths['/api/user/all'].get.description).toContain('Requires role: admin');
    expect(document.paths['/api/video/upload/{videoId}'].post.description).toContain('Requires role: editor');
    const packet = document.paths['/api/video/upload/{videoId}/{uploadId}/{kind}'].put;
    expect(packet.description).toContain('Requires role: editor');
    expect(packet.requestBody.content['application/octet-stream'].schema).toMatchObject({ type: 'string', format: 'binary' });
    expect(document.paths['/api/comment/change/{commentId}'].patch.description).toContain('Requires role: moderator');
    expect(document.paths['/api/comments/{videoId}'].get.description).toBe('Requires an authenticated user.');
    for (const path of Object.keys(document.paths).filter((path) => path.startsWith('/api/'))) {
      for (const method of ['get', 'head', 'post', 'put', 'patch', 'delete']) if (document.paths[path][method]) expect(document.paths[path][method].security).toEqual([{ cookieAuth: [], ...(!['get', 'head'].includes(method) ? { csrf: [] } : {}) }]);
    }
    expect((await app.inject('/api/user/me')).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/user/all', headers: { cookie: '__Host-videovault-session=editor-token', 'x-csrf-token': 'c'.repeat(43) } })).statusCode).toBe(403);
  });

  test('documents request/response schemas, pagination limits and empty 204 responses', async () => {
    const document = (await app.inject('/docs/json')).json();
    const account = dereference(document, document.paths['/api/user/me'].get.responses['200'].content['application/json'].schema);
    expect(account.properties).toHaveProperty('username');
    expect(account.properties).not.toHaveProperty('loginHash');
    const pagination = document.paths['/api/comments/{videoId}'].get.parameters;
    expect(pagination).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'pagesize', in: 'query', schema: expect.objectContaining({ type: 'integer', default: 100, minimum: 1, maximum: 1000 }) })]));
    const replacement = document.paths['/api/video/change/files/{videoId}'].patch;
    const body = dereference(document, replacement.requestBody.content['application/json'].schema);
    expect(body.required).toEqual(expect.arrayContaining(['lastModified', 'hmac']));
    expect(body.minProperties).toBe(3);
    expect(body.additionalProperties).toBe(false);
    expect(body.properties).not.toHaveProperty('meta');
    expect(replacement.responses['204'].content).toBeUndefined();
  });

  test('documents bootstrap as public with a strict version and instance salt response schema', async () => {
    const document = (await app.inject('/docs/json')).json();
    const bootstrap = document.paths['/bootstrap'].get;
    expect(bootstrap.security).toEqual([]);
    expect(bootstrap.tags).toEqual(['Authentication']);
    expect(bootstrap.description).toContain('Public.');
    const body = dereference(document, bootstrap.responses['200'].content['application/json'].schema);
    expect(body.required).toEqual(expect.arrayContaining(['version', 'instanceSalt', 'meta']));
    expect(body.additionalProperties).toBe(false);
    const salt = dereference(document, (body.properties as Record<string, unknown>).instanceSalt);
    expect(salt).toMatchObject({ type: 'string', minLength: 64, maxLength: 64, pattern: '^[0-9a-fA-F]{64}$' });
    const response = await app.inject('/bootstrap');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ version: 1, instanceSalt: 'ab'.repeat(32), app: { title: 'VideoVault' }, meta: DEFAULT_META_CONFIG });
    const meta = dereference(document, (body.properties as Record<string, unknown>).meta);
    expect(meta.required).toEqual(expect.arrayContaining(['recorded', 'fields', 'sorting']));
    expect(meta.additionalProperties).toBe(false);
  });

  test('documents required video description and recording date and their editor-only update routes', async () => {
    const document = (await app.inject('/docs/json')).json();
    const submit = document.paths['/api/video/submit'].post;
    const body = dereference(document, submit.requestBody.content['application/json'].schema);
    expect(body.required).toEqual(expect.arrayContaining(['description', 'recorded']));
    const properties = body.properties as Record<string, unknown>;
    expect(dereference(document, properties.description)).toMatchObject({ type: 'string', minLength: 1, maxLength: 1_000_000 });
    expect(dereference(document, properties.recorded)).toMatchObject({ type: 'string', format: 'date-time' });
    for (const field of ['description', 'recorded']) {
      const route = document.paths[`/api/video/change/${field}/{videoId}`].patch;
      expect(route.description).toContain('Requires role: editor');
      expect(route.security).toEqual([{ cookieAuth: [], csrf: [] }]);
      const change = dereference(document, route.requestBody.content['application/json'].schema);
      expect(change.required).toEqual(expect.arrayContaining([field, 'lastModified', 'hmac']));
      expect(change.additionalProperties).toBe(false);
      expect(route.responses['204'].content).toBeUndefined();
    }
  });

  test('documents multipart file selectors and binary downloads with correct content types', async () => {
    const document = (await app.inject('/docs/json')).json();
    const upload = document.paths['/api/video/upload/{videoId}'].post;
    const body = dereference(document, upload.requestBody.content['multipart/form-data'].schema);
    expect(body.properties).toMatchObject({ video: { type: 'string', format: 'binary' }, thumbnail: { type: 'string', format: 'binary' } });
    expect(JSON.stringify(body)).toContain('12345');
    expect(JSON.stringify(body)).toContain('6789');
    expect(upload.description).toContain('New videos require both files');
    for (const path of ['/api/video/file/{videoId}', '/api/video/thumbnail/{videoId}']) {
      const responses = document.paths[path].get.responses;
      expect(responses['200'].content['application/octet-stream'].schema).toMatchObject({ type: 'string', format: 'binary' });
      expect(responses['4XX'].content['application/json']).toBeDefined();
    }
  });

  test('documents nullable author names as response-only comment metadata', async () => {
    const document = (await app.inject({ url: '/docs/json' })).json();
    const properties = document.paths['/api/comments/{videoId}'].get.responses['200'].content['application/json'].schema.properties.comments.items.properties;
    expect(properties.displayName).toMatchObject({ type: 'string', nullable: true });
    const submit = document.paths['/api/comment/submit'].post.requestBody.content['application/json'].schema.properties;
    expect(submit).not.toHaveProperty('displayName');
  });

  test('generates YAML as well as JSON', async () => {
    const response = await app.inject('/docs/yaml');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('openapi: 3.0.3');
    expect(response.body).toContain('/api/video/change/files/');
  });

  test('documentation-only multipart schemas do not change runtime stream validation', async () => {
    await app.inject('/docs/json');
    const boundary = 'swagger-upload-test';
    const payload =
      ['video', 'thumbnail'].map((field) => `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${field}.bin"\r\nContent-Type: application/octet-stream\r\n\r\n${field}-bytes\r\n`).join('') + `--${boundary}--\r\n`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/video/upload/documented',
      headers: { cookie: '__Host-videovault-session=token', 'x-csrf-token': 'c'.repeat(43), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload
    });
    expect(response.statusCode).toBe(201);
    expect(await readFile(join(directory, 'tmp', 'documented.video'), 'utf8')).toBe('video-bytes');
    expect(await readFile(join(directory, 'tmp', 'documented.thumbnail'), 'utf8')).toBe('thumbnail-bytes');
  });
});
