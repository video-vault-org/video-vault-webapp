import { DatabaseConflictError } from '@/db/errors/DatabaseConflictError';
import { FastifyRequest, FastifyReply } from 'fastify';
import { createHttpServer } from '@/http/app';
import { authentication, authorization, currentUser } from '@/http/middleware';
import { handleErrors, HttpError } from '@/http/errors';
import { UploadStore } from '@/http/uploads';

describe('Fastify hooks and errors', () => {
  test('authorization and currentUser require preceding authentication', async () => {
    const app = createHttpServer({ logger: false });
    const authorize = jest.fn();
    app.get('/roles', { onRequest: authorization({ authorize }, ['admin']) }, async () => null);
    app.get('/user', async (request) => currentUser(request));
    try {
      expect((await app.inject('/roles')).statusCode).toBe(401);
      expect((await app.inject('/user')).statusCode).toBe(401);
      expect(authorize).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test('missing credentials do not call the authentication service', async () => {
    const app = createHttpServer({ logger: false });
    const authenticate = jest.fn();
    app.get('/', { onRequest: authentication({ authenticate }) }, async () => null);
    try {
      const response = await app.inject('/');
      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
      expect(authenticate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test.each([
    { name: 'missing resource', error: new HttpError(404, 'Missing'), status: 404, message: 'Missing' },
    { name: 'database conflict', error: new DatabaseConflictError('Private conflict details', { cause: new Error('Private cause') }), status: 409, message: 'Resource already exists' },
    { name: 'untyped database error', error: Object.assign(new Error('private'), { name: 'DatabaseConflictError' }), status: 500, message: 'Internal server error' },
    { name: 'invalid URI', error: new URIError('private'), status: 400, message: 'Invalid request' },
    { name: 'internal failure', error: new Error('private'), status: 500, message: 'Internal server error' }
  ])('sanitizes $name into HTTP $status', async ({ error, status, message }) => {
    const app = createHttpServer({ logger: false });
    app.get('/', async () => {
      throw error;
    });
    try {
      const response = await app.inject('/');
      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual({ error: message });
    } finally {
      await app.close();
    }
  });

  test('logs errors after headers were sent and closes the raw response', () => {
    const failure = new Error('late');
    const log = { error: jest.fn() };
    const destroy = jest.fn();
    handleErrors(failure, { log } as unknown as FastifyRequest, { raw: { headersSent: true, destroy } } as unknown as FastifyReply);
    expect(log.error).toHaveBeenCalledWith({ err: failure }, 'Response failed after headers were sent');
    expect(destroy).toHaveBeenCalledWith();
  });

  test.each([0, -1, 0.5, NaN, Infinity])('rejects invalid upload size limits %s', (limit) => {
    expect(() => new UploadStore({ maxVideoBytes: limit })).toThrow(RangeError);
    expect(() => new UploadStore({ maxThumbnailBytes: limit })).toThrow(RangeError);
  });
});
