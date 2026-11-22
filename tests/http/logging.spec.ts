import { Writable, Readable } from 'node:stream';
import request from 'supertest';
import { createHttpServer, createApp } from '@/http/app';
import { loggingOptions } from '@/http/logging';
import { HttpError } from '@/http/errors';
import { AuthService } from '@/service/AuthService';
import { UserService } from '@/service/UserService';
import { VideoService } from '@/service/VideoService';
import { CommentService } from '@/service/CommentService';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { InMemoryStorageAdapter } from '@/storage/adapters/InMemoryStorageAdapter';
import { StorageWrapper } from '@/storage/StorageWrapper';

const capture = function (terminal = false, level = 'info') {
  let output = '';
  const destination = new Writable({
    write(chunk, _encoding, done) {
      output += chunk.toString();
      done();
    }
  });
  return {
    options: loggingOptions({ destination, terminal, level }),

    output: () => output,

    records: () =>
      output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line: string) => JSON.parse(line))
  };
};

describe('Fastify native Pino logging', () => {
  test('writes one JSON line per native log message and omits custom error properties', async () => {
    const captured = capture();
    const app = createHttpServer({ logger: captured.options });
    try {
      app.log.info('Information');
      app.log.warn('Warning');
      app.log.error({ err: Object.assign(new Error('Failure\nwith details'), { secret: 'never-log-me' }) }, 'Failed');
      expect(captured.records().map(({ level }) => level)).toEqual([30, 40, 50]);
      expect(captured.records()[2].err).toMatchObject({ type: 'Error', message: 'Failure\nwith details', stack: expect.any(String) });
      expect(captured.output().split('\n')).toHaveLength(4);
      expect(captured.output()).not.toContain('\u001b[');
      expect(captured.output()).not.toContain('never-log-me');
    } finally {
      await app.close();
    }
  });

  test('writes colored single-line terminal records, including multiline errors', async () => {
    const captured = capture(true);
    const app = createHttpServer({ logger: captured.options });
    try {
      app.log.info('Information');
      app.log.warn('Warning');
      app.log.error({ err: new Error('Failure\nwith details') }, 'Failed');
      expect(captured.output()).toContain('\u001b[');
      expect(captured.output()).toContain('ERROR');
      expect(captured.output().trim().split('\n')).toHaveLength(3);
    } finally {
      await app.close();
    }
  });

  test('honors the configured minimum severity', async () => {
    const captured = capture(false, 'warn');
    const app = createHttpServer({ logger: captured.options });
    try {
      app.log.info('Hidden');
      app.log.warn('Visible');
      expect(captured.records().map(({ msg }) => msg)).toEqual(['Visible']);
    } finally {
      await app.close();
    }
  });

  test('defaults to stdout TTY status and LOG_LEVEL', async () => {
    const previous = process.env.LOG_LEVEL;
    const tty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    try {
      process.env.LOG_LEVEL = 'warn';
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      let output = '';
      const destination = new Writable({
        write(chunk, _encoding, done) {
          output += chunk.toString();
          done();
        }
      });
      const app = createHttpServer({ logger: loggingOptions({ destination }) });
      app.log.warn('Visible');
      expect(JSON.parse(output)).toMatchObject({ level: 40, msg: 'Visible' });
      await app.close();
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      const terminal = createHttpServer({ logger: loggingOptions({ destination }) });
      terminal.log.warn('Terminal');
      expect(output).toContain('\u001b[');
      await terminal.close();
    } finally {
      if (previous === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = previous;
      if (tty) Object.defineProperty(process.stdout, 'isTTY', tty);
      else Reflect.deleteProperty(process.stdout, 'isTTY');
    }
  });

  test('logs arrival and completion with native request ID and elapsed time', async () => {
    const captured = capture();
    const app = createHttpServer({ logger: captured.options });

    app.get('/slow', async (_request, reply) => {
      await new Promise((done) => setTimeout(done, 20));
      return reply.code(204).send();
    });

    try {
      const response = await app.inject({ url: '/slow?token=secret-query', headers: { 'x-request-id': 'untrusted-id' } });
      const [received, completed] = captured.records();
      expect(response.statusCode).toBe(204);
      expect(received).toMatchObject({ level: 30, msg: 'Request received', req: { id: response.headers['x-request-id'], method: 'GET', path: '/slow' } });
      expect(received.req.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(received.req.id).not.toBe('untrusted-id');
      expect(completed).toMatchObject({ level: 30, reqId: received.reqId, res: { statusCode: 204 }, responseTime: expect.any(Number) });
      expect(completed.responseTime).toBeGreaterThanOrEqual(15);
      expect(captured.records()).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  test.each([200, 302, 400, 401, 403, 404, 409, 413, 500, 503])('selects severity for HTTP %i', async (status) => {
    const captured = capture();
    const app = createHttpServer({ logger: captured.options });

    app.get('/', async (_request, reply) => reply.code(status).send(''));

    try {
      await app.inject('/');
      expect(captured.records()[1]).toMatchObject({ level: status >= 500 ? 50 : status >= 400 ? 40 : 30, res: { statusCode: status } });
    } finally {
      await app.close();
    }
  });

  test('records original unexpected errors once and returns generic error responses', async () => {
    const captured = capture();
    const app = createHttpServer({ logger: captured.options });

    app.get('/', async () => {
      throw new Error('Database unavailable');
    });

    try {
      const response = await app.inject('/');
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'Internal server error' });
      expect(captured.records()).toHaveLength(2);
      expect(captured.records()[1]).toMatchObject({ level: 50, msg: 'Request failed', err: { message: 'Database unavailable' } });
    } finally {
      await app.close();
    }
  });

  test('handles explicit HTTP failures and non-Error exceptions', async () => {
    const captured = capture();
    const app = createHttpServer({ logger: captured.options });

    app.get('/explicit', async () => {
      throw new HttpError(503, 'Unavailable');
    });

    app.get('/unknown', async () => {
      throw 'sensitive-unknown-value';
    });

    try {
      expect((await app.inject('/explicit')).statusCode).toBe(503);
      expect((await app.inject('/unknown')).statusCode).toBe(500);
      expect(captured.records()[1].err.message).toBe('Unavailable');
      expect(captured.records()[3].err.message).toBe('Unknown server error');
    } finally {
      await app.close();
    }
  });

  test('logs stream errors with request correlation when a response is aborted', async () => {
    const captured = capture();
    const app = createHttpServer({ logger: captured.options });

    app.get('/', async (_request, reply) => {
      const stream = new Readable({
        read() {
          this.push('partial');
          this._read = () => undefined;

          setImmediate(() => this.destroy(new Error('Streaming failed')));
        }
      });
      return reply.type('application/octet-stream').send(stream);
    });

    try {
      await app.ready();
      await expect(request(app.server).get('/')).rejects.toThrow(/aborted|socket hang up/);
      await new Promise(setImmediate);
      expect(captured.records()).toEqual(expect.arrayContaining([expect.objectContaining({ level: 50, reqId: expect.any(String), err: expect.objectContaining({ message: 'Streaming failed' }) })]));
    } finally {
      await app.close();
    }
  });

  test('supports native request-scoped warnings', async () => {
    const captured = capture();
    const app = createHttpServer({ logger: captured.options });

    app.get('/', async (request) => {
      request.log.warn('Service warning');
      return null;
    });

    try {
      await app.inject('/');
      expect(captured.records()[1]).toMatchObject({ level: 40, msg: 'Service warning', reqId: captured.records()[0].reqId });
    } finally {
      await app.close();
    }
  });

  test('the real app never logs request/response bodies, tokens, cookies or query secrets', async () => {
    const captured = capture();
    const db = new InMemoryDatabaseAdapter();
    const auth = new AuthService(db);
    jest.spyOn(auth, 'login').mockResolvedValue(null);
    const app = createApp({ auth, users: new UserService(db), videos: new VideoService(new StorageWrapper(new InMemoryStorageAdapter()), db), comments: new CommentService(db) }, { instanceSalt: 'ab'.repeat(32), logger: captured.options });
    try {
      expect(
        (await app.inject({ method: 'POST', url: '/login?token=query-secret', headers: { authorization: 'Bearer header-secret', cookie: 'session=cookie-secret' }, payload: { username: 'private-user', loginHash: 'body-secret' } })).statusCode
      ).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/login', payload: { username: 'private-user', loginHash: 'invalid-secret', unexpected: 'validation-secret' } })).statusCode).toBe(400);
      jest.mocked(auth.login).mockResolvedValue('response-token-secret');
      expect((await app.inject({ method: 'POST', url: '/login', payload: { username: 'private-user', loginHash: 'body-secret' } })).statusCode).toBe(200);
      expect(
        captured
          .records()
          .filter(({ reqId }) => reqId)
          .map(({ level }) => level)
      ).toEqual([30, 40, 30, 40, 30, 30]);
      for (const secret of ['query-secret', 'header-secret', 'cookie-secret', 'body-secret', 'private-user', 'invalid-secret', 'validation-secret', 'response-token-secret']) expect(captured.output()).not.toContain(secret);
    } finally {
      await app.close();
      jest.restoreAllMocks();
    }
  });
});
