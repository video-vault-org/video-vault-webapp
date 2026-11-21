import express from 'express';
import { Writable } from 'node:stream';
import request from 'supertest';
import { createLogger, requestLogging } from '@/http/logging';
import { handleErrors, HttpError } from '@/http/errors';
import { createApp } from '@/http/app';
import { AuthService } from '@/service/AuthService';
import { UserService } from '@/service/UserService';
import { VideoService } from '@/service/VideoService';
import { CommentService } from '@/service/CommentService';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';
import { StorageWrapper } from '@/storage/StorageWrapper';

function capture(terminal = false, level: 'info' | 'warn' = 'info') {
  let output = '';
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    }
  });
  return {
    log: createLogger({ destination, terminal, level }),
    output: () => output,
    records: () =>
      output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line: string) => JSON.parse(line))
  };
}

describe('Pino logging', () => {
  test('writes one JSON line per message to non-terminal output, including serialized errors', () => {
    const { log, output, records } = capture();
    log.info('Information');
    log.warn('Warning');
    log.error({ err: Object.assign(new Error('Failure\nwith details'), { secret: 'never-log-me' }) }, 'Failed');
    expect(records().map(({ level }) => level)).toEqual([30, 40, 50]);
    expect(records()[2].err).toMatchObject({ type: 'Error', message: 'Failure\nwith details', stack: expect.stringContaining('Error: Failure') });
    expect(output().split('\n')).toHaveLength(4);
    expect(output()).not.toContain('\u001b[');
    expect(output()).not.toContain('never-log-me');
  });

  test('writes colored single-line terminal records, including errors and stacks', async () => {
    const { log, output } = capture(true);
    log.info('Information');
    log.warn('Warning');
    log.error({ err: new Error('Failure\nwith details') }, 'Failed');
    await new Promise(setImmediate);
    expect(output()).toContain('\u001b[');
    expect(output()).toContain('INFO');
    expect(output()).toContain('WARN');
    expect(output()).toContain('ERROR');
    expect(output()).toContain('Failure');
    expect(output().trim().split('\n')).toHaveLength(3);
  });

  test('honors the configured minimum severity', () => {
    const { log, records } = capture(false, 'warn');
    log.info('Hidden');
    log.warn('Visible');
    expect(records().map(({ msg }) => msg)).toEqual(['Visible']);
  });

  test('uses stdout TTY status and LOG_LEVEL by default', async () => {
    const environment = process.env.LOG_LEVEL;
    const tty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    try {
      process.env.LOG_LEVEL = 'warn';
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      let output = '';
      const destination = new Writable({
        write(chunk, _encoding, callback) {
          output += chunk.toString();
          callback();
        }
      });
      const log = createLogger({ destination });
      log.info('Hidden');
      log.warn('Visible');
      expect(JSON.parse(output)).toMatchObject({ level: 40, msg: 'Visible' });
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      createLogger({ destination }).warn('Terminal');
      await new Promise(setImmediate);
      expect(output).toContain('\u001b[');
    } finally {
      if (environment === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = environment;
      if (tty) Object.defineProperty(process.stdout, 'isTTY', tty);
      else Reflect.deleteProperty(process.stdout, 'isTTY');
    }
  });

  test('logs arrival and completion with a server-generated correlation ID and duration', async () => {
    const { log, records } = capture();
    const app = express();
    app.use(requestLogging(log));
    app.get('/slow', (_request, response) => setTimeout(() => response.sendStatus(204), 20));
    const response = await request(app).get('/slow?token=secret-query').set('X-Request-ID', 'untrusted-id');
    const [received, completed] = records();
    expect(response.status).toBe(204);
    expect(received).toMatchObject({ level: 30, msg: 'Request received', req: { id: response.headers['x-request-id'], method: 'GET', path: '/slow' } });
    expect(received.req.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(received.req.id).not.toBe('untrusted-id');
    expect(completed).toMatchObject({ level: 30, msg: 'Request completed', req: received.req, res: { statusCode: 204 }, responseTime: expect.any(Number) });
    expect(completed.responseTime).toBeGreaterThanOrEqual(15);
    expect(records()).toHaveLength(2);
  });

  test.each([200, 302, 400, 401, 403, 404, 409, 413, 500, 503])('selects severity for status %i', async (status) => {
    const { log, records } = capture();
    const app = express();
    app.use(requestLogging(log));
    app.get('/', (_request, response) => response.sendStatus(status));
    await request(app).get('/');
    expect(records()[1]).toMatchObject({ level: status >= 500 ? 50 : status >= 400 ? 40 : 30, res: { statusCode: status } });
  });

  test('records the original unexpected error once while keeping the HTTP response generic', async () => {
    const { log, records } = capture();
    const app = express();
    app.use(requestLogging(log));
    app.get('/', () => {
      throw new Error('Database unavailable');
    });
    app.use(handleErrors);
    await request(app).get('/').expect(500, { error: 'Internal server error' });
    expect(records()).toHaveLength(2);
    expect(records()[1]).toMatchObject({ level: 50, msg: 'Request failed', err: { type: 'Error', message: 'Database unavailable', stack: expect.any(String) } });
  });

  test('logs explicit server errors and handles non-Error exceptions', async () => {
    const { log, records } = capture();
    const app = express();
    app.use(requestLogging(log));
    app.get('/explicit', () => {
      throw new HttpError(503, 'Unavailable');
    });
    app.get('/unknown', () => {
      throw 'sensitive-unknown-value';
    });
    app.use(handleErrors);
    await request(app).get('/explicit').expect(503);
    await request(app).get('/unknown').expect(500);
    expect(records()[1].err.message).toBe('Unavailable');
    expect(records()[3].err.message).toBe('Unknown server error');
  });

  test('logs the original streaming error and the aborted response with a common request ID', async () => {
    const { log, records } = capture();
    const app = express();
    app.use(requestLogging(log));
    app.get('/stream', (_request, response, next) => {
      response.write('partial');
      setImmediate(() => next(new Error('Streaming failed')));
    });
    app.use(handleErrors);
    await expect(request(app).get('/stream')).rejects.toThrow(/aborted|socket hang up/);
    await new Promise(setImmediate);
    expect(records().map(({ level }) => level)).toEqual([30, 50, 50]);
    expect(records()[1]).toMatchObject({ msg: 'Response failed after headers were sent', err: { message: 'Streaming failed' } });
    expect(records()[2]).toMatchObject({ msg: 'Request failed', responseTime: expect.any(Number), req: records()[0].req });
  });

  test('supports request-scoped warnings with the same correlation metadata', async () => {
    const { log, records } = capture();
    const app = express();
    app.use(requestLogging(log));
    app.get('/', (request, response) => {
      request.log.warn('Service warning');
      response.sendStatus(204);
    });
    await request(app).get('/');
    expect(records()[1]).toMatchObject({ level: 40, msg: 'Service warning', req: records()[0].req });
  });

  test('the real Express app logs login and validation failures without bodies, headers or query secrets', async () => {
    const { log, output, records } = capture();
    const db = new InMemoryDatabaseAdapter();
    const auth = new AuthService(db);
    jest.spyOn(auth, 'login').mockResolvedValue(null);
    const app = createApp({ auth, users: new UserService(db), videos: new VideoService(new StorageWrapper(new InMemoryStorageAdapter()), db), comments: new CommentService(db) }, { logger: log });
    await request(app).post('/login?token=query-secret').set('Authorization', 'Bearer header-secret').set('Cookie', 'session=cookie-secret').send({ username: 'private-user', loginHash: 'body-secret' }).expect(401);
    await request(app).post('/login').send({ username: 'private-user', loginHash: 'invalid-secret', unexpected: 'validation-secret' }).expect(400);
    jest.mocked(auth.login).mockResolvedValue('response-token-secret');
    await request(app).post('/login').send({ username: 'private-user', loginHash: 'body-secret' }).expect(200, { token: 'response-token-secret' });
    expect(output()).not.toContain('response-token-secret');
    expect(records().map(({ level }) => level)).toEqual([30, 40, 30, 40, 30, 30]);
    for (const secret of ['query-secret', 'header-secret', 'cookie-secret', 'body-secret', 'private-user', 'invalid-secret', 'validation-secret']) expect(output()).not.toContain(secret);
    expect(records()[0].req).toEqual({ id: expect.any(String), method: 'POST', path: '/login' });
    expect(records()[1].res).toEqual({ statusCode: 401 });
  });
});
