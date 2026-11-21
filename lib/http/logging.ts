import { FastifyBaseLogger, FastifyLoggerOptions, FastifyReply, FastifyRequest, LogController } from 'fastify';
import { Writable } from 'node:stream';
import pretty from 'pino-pretty';

/** Configures Fastify's built-in Pino: single-line color on a terminal, NDJSON when stdout is redirected. */
function loggingOptions({
  destination = process.stdout,
  terminal = Boolean(process.stdout.isTTY),
  level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info')
}: { destination?: Writable; terminal?: boolean; level?: string } = {}): FastifyLoggerOptions {
  const format = pretty.prettyFactory({ colorize: true, singleLine: true, errorLikeObjectKeys: [], translateTime: 'SYS:standard' });
  return {
    level,
    stream: terminal ? { write: (line: string) => destination.write(format(line).trimEnd().replace(/\r/g, '\\r').replace(/\n/g, '\\n') + '\n') } : destination,
    serializers: {
      req: (request: FastifyRequest) => ({ id: request.id, method: request.method, path: request.url.split('?')[0] }),
      res: (reply) => ({ statusCode: reply.statusCode }),
      err: (error: Error) => ({ type: error.name, message: error.message, stack: error.stack ?? '' })
    }
  };
}

/** Keeps native request timing and correlation while assigning warn to 4xx and error to 5xx. */
class HttpLogController extends LogController {
  public incomingRequest(request: FastifyRequest): void {
    request.log.info({ req: request }, 'Request received');
  }

  public requestCompleted(error: Error | null | undefined, request: FastifyRequest, reply: FastifyReply): void {
    const failure = error ?? request.failure;
    const level = failure || reply.statusCode >= 500 ? 'error' : reply.statusCode >= 400 ? 'warn' : 'info';
    request.log[level]({ req: request, res: reply, responseTime: reply.elapsedTime, ...(failure ? { err: failure } : {}) }, failure || reply.statusCode >= 500 ? 'Request failed' : 'Request completed');
  }

  public streamError(error: Error, request: FastifyRequest): void {
    request.failure = error;
    request.log.error({ err: error }, 'Response stream failed');
  }
}

type BackgroundLogger = Pick<FastifyBaseLogger, 'info' | 'error'>;
export { loggingOptions, HttpLogController, BackgroundLogger };
