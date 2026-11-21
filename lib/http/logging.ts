import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Writable } from 'node:stream';
import pino, { Logger } from 'pino';
import pinoHttp, { HttpLogger } from 'pino-http';
import pretty from 'pino-pretty';

/**
 * Creates a logger: a terminal receives colored single-line output, redirected stdout receives NDJSON.
 * LOG_LEVEL defaults to info (silent under Jest). No worker or separate log file is created.
 * Explicit options allow capturing output and selecting the format in tests or embedded use.
 */
function createLogger({
  destination = process.stdout,
  terminal = Boolean(process.stdout.isTTY),
  level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info')
}: { destination?: Writable; terminal?: boolean; level?: string } = {}): Logger {
  // Use the formatter directly: the pretty transport otherwise expands error stacks across multiple lines.
  const format = pretty.prettyFactory({ colorize: true, singleLine: true, errorLikeObjectKeys: [], translateTime: 'SYS:standard' });
  const output = terminal ? { write: (line: string) => destination.write(format(line).trimEnd().replace(/\r/g, '\\r').replace(/\n/g, '\\n') + '\n') } : destination;
  return pino(
    {
      level,
      serializers: {
        err: (error: Error) => ({ type: error.name, message: error.message, stack: error.stack })
      }
    },
    output
  );
}

const logger = createLogger();

/**
 * Logs request arrival and response completion, including full response duration in milliseconds.
 * 4xx responses are warnings; 5xx and aborted requests are errors. Other requests use info.
 * Only method, path (without query), generated request ID and response status are serialized.
 * Bodies, headers, cookies and user objects are omitted. X-Request-ID correlates the client response with its logs.
 */
function requestLogging(log: Logger = logger): HttpLogger {
  return pinoHttp<IncomingMessage, ServerResponse>({
    logger: log,
    wrapSerializers: false,
    genReqId: (_request, response) => {
      const id = randomUUID();
      response.setHeader('X-Request-ID', id);
      return id;
    },
    serializers: {
      req: (request: IncomingMessage & { originalUrl?: string }) => ({ id: request.id, method: request.method, path: (request.originalUrl ?? request.url ?? '').split('?')[0] }),
      res: (response: ServerResponse) => ({ statusCode: response.statusCode })
    },
    customLogLevel: (_request, response, error) => (response.statusCode >= 500 || error || response.err || (response.destroyed && !response.writableFinished) ? 'error' : response.statusCode >= 400 ? 'warn' : 'info'),
    customReceivedMessage: () => 'Request received',
    customSuccessMessage: (_request, response) => (response.destroyed && !response.writableFinished ? 'Request aborted' : 'Request completed'),
    customErrorMessage: () => 'Request failed'
  });
}

export { createLogger, logger, requestLogging };
