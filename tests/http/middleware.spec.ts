import { DatabaseConflictError } from '@/db/errors/DatabaseConflictError';
import express from 'express';
import request from 'supertest';
import { authentication, authorization, currentUser } from '@/http/middleware';
import { handleErrors, HttpError } from '@/http/errors';
import { UploadStore } from '@/http/uploads';

describe('HTTP middleware and errors', () => {
  test('authorization and currentUser require a preceding authentication middleware', async () => {
    const app = express();
    const authorize = jest.fn();
    app.get('/roles', authorization({ authorize }, ['admin']), (_request, response) => response.end());
    app.get('/user', (_request, response) => response.json(currentUser(response)));
    app.use(handleErrors);
    await request(app).get('/roles').expect(401);
    await request(app).get('/user').expect(401);
    expect(authorize).not.toHaveBeenCalled();
  });

  test('missing credentials do not call the authentication service', async () => {
    const app = express();
    const authenticate = jest.fn();
    app.get('/', authentication({ authenticate }));
    app.use(handleErrors);
    await request(app).get('/').expect(401);
    expect(authenticate).not.toHaveBeenCalled();
  });

  test.each([
    { name: 'missing resource', error: new HttpError(404, 'Missing'), status: 404, message: 'Missing' },
    { name: 'database conflict', error: new DatabaseConflictError('Private conflict details', { cause: new Error('Private cause') }), status: 409, message: 'Resource already exists' },
    { name: 'untyped database error', error: Object.assign(new Error('private'), { name: 'DatabaseConflictError' }), status: 500, message: 'Internal server error' },
    { name: 'invalid URI', error: new URIError('private'), status: 400, message: 'Invalid request' },
    { name: 'internal failure', error: new Error('private'), status: 500, message: 'Internal server error' }
  ])('sanitizes $name into HTTP $status', async ({ error, status, message }) => {
    const app = express();
    app.get('/', () => {
      throw error;
    });
    app.use(handleErrors);
    await request(app).get('/').expect(status, { error: message });
  });

  test('logs errors and closes the response after headers were sent', () => {
    const error = new Error('late');
    const next = jest.fn();
    const log = { error: jest.fn() };
    const destroy = jest.fn();
    handleErrors(error, { log } as unknown as Parameters<typeof handleErrors>[1], { headersSent: true, destroy } as unknown as Parameters<typeof handleErrors>[2], next);
    expect(log.error).toHaveBeenCalledWith({ err: error }, 'Response failed after headers were sent');
    expect(destroy).toHaveBeenCalledWith();
    expect(next).not.toHaveBeenCalled();
  });

  test.each([0, -1, 0.5, NaN, Infinity])('rejects invalid upload size limits %s', (limit) => {
    expect(() => new UploadStore({ maxVideoBytes: limit })).toThrow(RangeError);
    expect(() => new UploadStore({ maxThumbnailBytes: limit })).toThrow(RangeError);
  });
});
